import {
  createHash,
  createHmac,
  createPublicKey,
  randomUUID,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type DisplayAuthNonceRepository,
  type DisplayKeyRepository,
} from "#/application/ports/display-auth";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type RuntimeControlRepository } from "#/application/ports/runtime-controls";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  deriveDisplayStatus,
  GetDisplayManifestUseCase,
} from "#/application/use-cases/displays";
import { selectActiveScheduleByKind } from "#/domain/schedules/schedule";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { resolveClientIp } from "#/interfaces/http/lib/request-client-ip";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  errorResponseSchema,
  notFound,
  type ResponseContext,
  tooManyRequests,
  unauthorized,
  validationError,
} from "#/interfaces/http/responses";
import { publishAdminDisplayLifecycleEvent } from "#/interfaces/http/routes/displays/admin-lifecycle-events";
import {
  publishDisplayStreamEvent,
  subscribeToDisplayStream,
} from "#/interfaces/http/routes/displays/stream";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { type AuthSecurityStore } from "#/interfaces/http/security/redis-auth-security.store";
import { displayManifestSchema } from "#/interfaces/http/validators/displays.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const SIGNED_REQUEST_SKEW_MS = 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;
const STREAM_HEARTBEAT_INTERVAL_MS = 20 * 1000;
const displayRuntimeTags = ["Display Runtime"];
const MAX_TOKEN_SEGMENTS = 2;
const MAX_TOKEN_SEGMENT_BYTES = 2_048;
const MAX_DISPLAY_TOKEN_FIELD_BYTES = 256;
const MAX_KEY_ID_BYTES = 64;
const MAX_SIGNED_SIGNATURE_BYTES = 2_048;
const MAX_BODY_HASH_BYTES = 128;

const isString = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= maxBytes;

const createChallengeBodySchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  keyId: z.string().uuid(),
});

const verifyChallengeBodySchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  keyId: z.string().uuid(),
  signature: z.string().min(1),
});

const slugParamSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

const challengeTokenParamSchema = z.object({
  challengeToken: z.string().min(1),
});

const challengeResponseSchema = z.object({
  challengeToken: z.string().min(1),
  expiresAt: z.string(),
});

const toBase64Url = (value: string | Uint8Array): string =>
  Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");

const fromBase64Url = (value: string): Buffer => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, "base64");
};

const signChallengeToken = (payload: string, secret: string): string =>
  toBase64Url(createHmac("sha256", secret).update(payload).digest());

const safeCompare = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

const buildChallengeSigningPayload = (input: {
  challengeToken: string;
  slug: string;
  keyId: string;
}): string =>
  ["CHALLENGE", input.challengeToken, input.slug, input.keyId].join("\n");

const buildSignedRequestPayload = (input: {
  method: string;
  pathWithQuery: string;
  slug: string;
  keyId: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
}): string =>
  [
    input.method,
    input.pathWithQuery,
    input.slug,
    input.keyId,
    input.timestamp,
    input.nonce,
    input.bodyHash,
  ].join("\n");

const verifyEd25519Signature = (input: {
  publicKeyPem: string;
  payload: string;
  signatureBase64Url: string;
}): boolean => {
  try {
    const keyObject = createPublicKey(input.publicKeyPem);
    const signature = fromBase64Url(input.signatureBase64Url);
    return verify(
      null,
      Buffer.from(input.payload, "utf8"),
      keyObject,
      signature,
    );
  } catch {
    return false;
  }
};

const buildChallengeToken = (input: {
  challengeId: string;
  slug: string;
  keyId: string;
  challengeNonce: string;
  expiresAt: Date;
  secret: string;
}): string => {
  const payload = JSON.stringify({
    id: input.challengeId,
    s: input.slug,
    k: input.keyId,
    n: input.challengeNonce,
    e: input.expiresAt.toISOString(),
  });
  const encoded = toBase64Url(payload);
  const signature = signChallengeToken(encoded, input.secret);
  return `${encoded}.${signature}`;
};

const parseChallengeToken = (input: {
  token: string;
  secret: string;
  now: Date;
}): {
  challengeId: string;
  slug: string;
  keyId: string;
  challengeNonce: string;
  expiresAt: string;
} | null => {
  const tokenParts = input.token.split(".");
  if (
    tokenParts.length !== MAX_TOKEN_SEGMENTS ||
    tokenParts[0] == null ||
    tokenParts[1] == null
  ) {
    return null;
  }

  const [encodedPayload, signature] = tokenParts;
  if (
    encodedPayload.length === 0 ||
    signature.length === 0 ||
    encodedPayload.length > MAX_TOKEN_SEGMENT_BYTES ||
    signature.length > MAX_SIGNED_SIGNATURE_BYTES
  ) {
    return null;
  }

  const expected = signChallengeToken(encodedPayload, input.secret);
  if (!safeCompare(expected, signature)) {
    return null;
  }

  try {
    const payloadBytes = fromBase64Url(encodedPayload);
    if (payloadBytes.length > MAX_DISPLAY_TOKEN_FIELD_BYTES) {
      return null;
    }

    const payload = JSON.parse(payloadBytes.toString("utf8")) as {
      id?: string;
      s?: string;
      k?: string;
      n?: string;
      e?: string;
    };

    if (
      !isString(payload.id, MAX_DISPLAY_TOKEN_FIELD_BYTES) ||
      !isString(payload.s, MAX_DISPLAY_TOKEN_FIELD_BYTES) ||
      !isString(payload.k, MAX_KEY_ID_BYTES) ||
      !isString(payload.n, MAX_DISPLAY_TOKEN_FIELD_BYTES) ||
      !isString(payload.e, MAX_DISPLAY_TOKEN_FIELD_BYTES)
    ) {
      return null;
    }

    const expiresMs = Date.parse(payload.e);
    if (!Number.isFinite(expiresMs) || expiresMs <= input.now.getTime()) {
      return null;
    }

    return {
      challengeId: payload.id,
      slug: payload.s,
      keyId: payload.k,
      challengeNonce: payload.n,
      expiresAt: payload.e,
    };
  } catch {
    return null;
  }
};

const toBodyHash = (body: string): string =>
  createHash("sha256").update(body).digest("base64url");

type DisplayRouteDeps = {
  jwtSecret: string;
  downloadUrlExpiresInSeconds: number;
  scheduleTimeZone?: string;
  authSecurityStore: AuthSecurityStore;
  rateLimits: {
    windowSeconds: number;
    authChallengeMaxAttempts: number;
    authVerifyMaxAttempts: number;
  };
  repositories: {
    displayRepository: DisplayRepository;
    scheduleRepository: ScheduleRepository;
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    runtimeControlRepository: RuntimeControlRepository;
    displayKeyRepository: DisplayKeyRepository;
    displayAuthNonceRepository: DisplayAuthNonceRepository;
  };
  storage: ContentStorage;
  defaultEmergencyContentId?: string;
};

type DisplayVars = {
  displayId: string;
};

const createRuntimeRateLimitMiddleware = (
  deps: DisplayRouteDeps,
  input: {
    keyPrefix: string;
    maxAttempts: number;
    message: string;
  },
) => {
  return async (c: ResponseContext, next: () => Promise<void>) => {
    const nowMs = Date.now();
    const ip = resolveClientIp({
      headers: {
        forwardedFor: c.req.header("x-forwarded-for"),
        realIp: c.req.header("x-real-ip"),
        cfConnectingIp: c.req.header("cf-connecting-ip"),
        xClientIp: c.req.header("x-client-ip"),
        forwarded: c.req.header("forwarded"),
      },
      trustProxyHeaders: env.TRUST_PROXY_HEADERS,
    });
    const key = `${input.keyPrefix}|${ip}`;
    const stats = await deps.authSecurityStore.consumeEndpointAttemptWithStats({
      key,
      nowMs,
      windowSeconds: deps.rateLimits.windowSeconds,
      maxAttempts: input.maxAttempts,
    });

    c.set("rateLimitLimit", String(stats.limit));
    c.set("rateLimitRemaining", String(stats.remaining));
    c.set("rateLimitReset", String(stats.resetEpochSeconds));
    c.set("rateLimitRetryAfter", String(stats.retryAfterSeconds));

    if (!stats.allowed) {
      logger.warn(
        {
          component: "displays",
          event: "display.rate_limit.exceeded",
          route: c.req.path,
          action: c.get("action"),
          ip,
          rateLimitKey: input.keyPrefix,
          limit: stats.limit,
          retryAfterSeconds: stats.retryAfterSeconds,
        },
        "Display runtime rate limit exceeded",
      );
      return tooManyRequests(c, input.message);
    }

    await next();
  };
};

const signedDisplayRequest = (deps: DisplayRouteDeps) => {
  return async (c: ResponseContext, next: () => Promise<void>) => {
    const params = slugParamSchema.safeParse(c.req.param());
    if (!params.success) {
      return validationError(c, "Invalid display slug");
    }
    const slug = params.data.slug;

    const keyId = c.req.header("x-display-key-id") ?? "";
    const timestamp = c.req.header("x-display-timestamp") ?? "";
    const nonce = c.req.header("x-display-nonce") ?? "";
    const signature = c.req.header("x-display-signature") ?? "";
    const bodyHashHeader = c.req.header("x-display-body-sha256") ?? "";
    const slugHeader = c.req.header("x-display-slug") ?? "";

    if (
      !keyId ||
      !timestamp ||
      !nonce ||
      !signature ||
      !bodyHashHeader ||
      !slugHeader
    ) {
      return unauthorized(c, "Missing signed request headers");
    }

    if (
      !isString(keyId, MAX_KEY_ID_BYTES) ||
      !isString(timestamp, MAX_DISPLAY_TOKEN_FIELD_BYTES) ||
      !isString(nonce, MAX_DISPLAY_TOKEN_FIELD_BYTES) ||
      !isString(signature, MAX_SIGNED_SIGNATURE_BYTES) ||
      !isString(bodyHashHeader, MAX_BODY_HASH_BYTES) ||
      !isString(slugHeader, MAX_DISPLAY_TOKEN_FIELD_BYTES)
    ) {
      return unauthorized(c, "Invalid signed request header format");
    }
    if (slugHeader !== slug) {
      return unauthorized(c, "Display slug mismatch");
    }

    const now = new Date();
    const timestampMs = Date.parse(timestamp);
    if (!Number.isFinite(timestampMs)) {
      return unauthorized(c, "Invalid signed request timestamp");
    }
    if (Math.abs(now.getTime() - timestampMs) > SIGNED_REQUEST_SKEW_MS) {
      return unauthorized(c, "Signed request timestamp out of bounds");
    }

    const display = await deps.repositories.displayRepository.findBySlug(slug);
    if (!display) {
      return notFound(c, "Display not found");
    }

    const activeKey =
      await deps.repositories.displayKeyRepository.findActiveByKeyId(keyId);
    if (!activeKey || activeKey.displayId !== display.id) {
      return unauthorized(c, "Invalid display key");
    }

    const rawBody = ["GET", "HEAD"].includes(c.req.method.toUpperCase())
      ? ""
      : await c.req.text();
    const computedHash = toBodyHash(rawBody);
    if (!safeCompare(computedHash, bodyHashHeader)) {
      return unauthorized(c, "Invalid body hash");
    }

    const nonceAllowed =
      await deps.repositories.displayAuthNonceRepository.consumeUnique({
        displayId: display.id,
        nonce,
        now,
        expiresAt: new Date(now.getTime() + NONCE_TTL_MS),
      });
    if (!nonceAllowed) {
      return unauthorized(c, "Request nonce replay detected");
    }

    const url = new URL(c.req.url);
    const payload = buildSignedRequestPayload({
      method: c.req.method.toUpperCase(),
      pathWithQuery: `${url.pathname}${url.search}`,
      slug: slug,
      keyId,
      timestamp,
      nonce,
      bodyHash: computedHash,
    });

    const isValidSignature = verifyEd25519Signature({
      publicKeyPem: activeKey.publicKey,
      payload,
      signatureBase64Url: signature,
    });
    if (!isValidSignature) {
      return unauthorized(c, "Invalid signed request signature");
    }

    c.set("displayId", display.id);
    await next();
  };
};

export const createDisplayRouter = (deps: DisplayRouteDeps) => {
  const router = new Hono<{ Variables: DisplayVars }>();

  const getManifest = new GetDisplayManifestUseCase({
    scheduleRepository: deps.repositories.scheduleRepository,
    playlistRepository: deps.repositories.playlistRepository,
    contentRepository: deps.repositories.contentRepository,
    contentStorage: deps.storage,
    displayRepository: deps.repositories.displayRepository,
    runtimeControlRepository: deps.repositories.runtimeControlRepository,
    downloadUrlExpiresInSeconds: deps.downloadUrlExpiresInSeconds,
    scheduleTimeZone: deps.scheduleTimeZone,
    defaultEmergencyContentId: deps.defaultEmergencyContentId,
  });

  router.post(
    "/auth/challenges",
    setAction("display.auth.challenge.create", {
      route: "/display-runtime/auth/challenges",
      actorType: "display",
      resourceType: "display",
    }),
    createRuntimeRateLimitMiddleware(deps, {
      keyPrefix: "display-runtime-auth-challenges",
      maxAttempts: deps.rateLimits.authChallengeMaxAttempts,
      message: "Too many authentication challenge requests. Try again later.",
    }),
    validateJson(createChallengeBodySchema),
    describeRoute({
      description: "Create a display runtime authentication challenge",
      tags: displayRuntimeTags,
      responses: {
        201: {
          description: "Challenge token issued",
          content: {
            "application/json": {
              schema: resolver(challengeResponseSchema),
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        404: {
          description: "Display not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        422: {
          description: "Invalid challenge request payload",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        429: {
          description: "Too many challenge requests",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const display = await deps.repositories.displayRepository.findBySlug(
          payload.slug,
        );
        if (!display) {
          return notFound(c, "Display not found");
        }
        const key =
          await deps.repositories.displayKeyRepository.findActiveByKeyId(
            payload.keyId,
          );
        if (!key || key.displayId !== display.id) {
          return unauthorized(c, "Display key is invalid");
        }

        const challengeId = randomUUID();
        const challengeNonce = randomUUID();
        const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
        const challengeToken = buildChallengeToken({
          challengeId,
          challengeNonce,
          slug: payload.slug,
          keyId: payload.keyId,
          expiresAt,
          secret: deps.jwtSecret,
        });

        return c.json(
          {
            challengeToken,
            expiresAt: expiresAt.toISOString(),
          },
          201,
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/auth/challenges/:challengeToken/verify",
    setAction("display.auth.challenge.verify", {
      route: "/display-runtime/auth/challenges/:challengeToken/verify",
      actorType: "display",
      resourceType: "display",
    }),
    createRuntimeRateLimitMiddleware(deps, {
      keyPrefix: "display-runtime-auth-verify",
      maxAttempts: deps.rateLimits.authVerifyMaxAttempts,
      message:
        "Too many authentication verification requests. Try again later.",
    }),
    validateParams(challengeTokenParamSchema),
    validateJson(verifyChallengeBodySchema),
    describeRoute({
      description:
        "Verify a display runtime authentication challenge signature",
      tags: displayRuntimeTags,
      responses: {
        204: {
          description: "Challenge verified",
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        404: {
          description: "Display not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        422: {
          description: "Invalid verification request payload",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        429: {
          description: "Too many verification requests",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");

        const challenge = parseChallengeToken({
          token: params.challengeToken,
          secret: deps.jwtSecret,
          now: new Date(),
        });
        if (!challenge) {
          return unauthorized(c, "Invalid challenge token");
        }
        if (
          challenge.slug !== payload.slug ||
          challenge.keyId !== payload.keyId
        ) {
          return unauthorized(c, "Challenge context mismatch");
        }

        const display = await deps.repositories.displayRepository.findBySlug(
          payload.slug,
        );
        if (!display) {
          return notFound(c, "Display not found");
        }

        const key =
          await deps.repositories.displayKeyRepository.findActiveByKeyId(
            payload.keyId,
          );
        if (!key || key.displayId !== display.id) {
          return unauthorized(c, "Display key is invalid");
        }

        const signingPayload = buildChallengeSigningPayload({
          challengeToken: params.challengeToken,
          slug: payload.slug,
          keyId: payload.keyId,
        });
        const valid = verifyEd25519Signature({
          publicKeyPem: key.publicKey,
          payload: signingPayload,
          signatureBase64Url: payload.signature,
        });
        if (!valid) {
          return unauthorized(c, "Challenge signature is invalid");
        }

        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:slug/manifest",
    setAction("display.manifest.read", {
      route: "/display-runtime/:slug/manifest",
      actorType: "display",
      resourceType: "display",
    }),
    signedDisplayRequest(deps),
    describeRoute({
      description: "Get signed display manifest payload",
      tags: displayRuntimeTags,
      responses: {
        200: {
          description: "Display manifest",
          content: {
            "application/json": {
              schema: resolver(displayManifestSchema),
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        404: {
          description: "Display not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const displayId = String(c.get("displayId"));
        const result = await getManifest.execute({
          displayId,
          now: new Date(),
        });
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:slug/stream",
    setAction("display.stream.read", {
      route: "/display-runtime/:slug/stream",
      actorType: "display",
      resourceType: "display",
    }),
    signedDisplayRequest(deps),
    describeRoute({
      description: "Stream display runtime updates via SSE",
      tags: displayRuntimeTags,
      responses: {
        200: {
          description: "Server-sent events stream for display runtime updates",
          content: {
            "text/event-stream": {
              schema: {
                type: "string",
              },
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        404: {
          description: "Display not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const displayId = String(c.get("displayId"));
      const encoder = new TextEncoder();
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let isClosed = false;
      let streamController: ReadableStreamDefaultController<Uint8Array> | null =
        null;

      const safeEnqueue = (frame: string | Uint8Array): void => {
        if (isClosed) {
          return;
        }
        if (!streamController) {
          return;
        }
        try {
          streamController.enqueue(
            typeof frame === "string" ? encoder.encode(frame) : frame,
          );
        } catch {
          isClosed = true;
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          closeStreamController();
        }
      };

      const closeStream = (): void => {
        if (isClosed) {
          return;
        }
        isClosed = true;
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      };

      const closeStreamController = (): void => {
        if (!streamController) {
          return;
        }
        try {
          streamController.close();
        } catch {
          // Ignore repeated close attempts after stream teardown.
        }
      };

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          safeEnqueue(
            `event: connected\ndata: ${JSON.stringify({ displayId, timestamp: new Date().toISOString() })}\n\n`,
          );
          unsubscribe = subscribeToDisplayStream(displayId, (event) => {
            safeEnqueue(
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            );
          });
          heartbeat = setInterval(() => {
            safeEnqueue(": heartbeat\n\n");
          }, STREAM_HEARTBEAT_INTERVAL_MS);
        },
        cancel() {
          closeStream();
          closeStreamController();
        },
      });

      return c.newResponse(stream, 200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
    },
  );

  router.post(
    "/:slug/heartbeat",
    setAction("display.heartbeat", {
      route: "/display-runtime/:slug/heartbeat",
      actorType: "display",
      resourceType: "display",
    }),
    signedDisplayRequest(deps),
    describeRoute({
      description: "Post display heartbeat to update runtime status",
      tags: displayRuntimeTags,
      responses: {
        204: {
          description: "Heartbeat accepted",
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        404: {
          description: "Display not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const displayId = String(c.get("displayId"));
      const now = new Date();
      await deps.repositories.displayRepository.touchSeen(displayId, now);

      const [display, schedules] = await Promise.all([
        deps.repositories.displayRepository.findById(displayId),
        deps.repositories.scheduleRepository.listByDisplay(displayId),
      ]);
      if (display) {
        const activePlaylistSchedule = selectActiveScheduleByKind(
          schedules,
          "PLAYLIST",
          now,
          deps.scheduleTimeZone ?? "UTC",
        );
        const activeFlashSchedule = selectActiveScheduleByKind(
          schedules,
          "FLASH",
          now,
          deps.scheduleTimeZone ?? "UTC",
        );
        const nextStatus = deriveDisplayStatus({
          lastSeenAt: now.toISOString(),
          hasActivePlayback:
            activePlaylistSchedule !== null || activeFlashSchedule !== null,
          now,
        });
        if (display.status !== nextStatus) {
          await deps.repositories.displayRepository.setStatus({
            id: display.id,
            status: nextStatus,
            at: now,
          });
          publishAdminDisplayLifecycleEvent({
            type: "display_status_changed",
            displayId: display.id,
            slug: display.slug,
            previousStatus: display.status,
            status: nextStatus,
            occurredAt: now.toISOString(),
          });
        }
      }

      publishDisplayStreamEvent({
        type: "manifest_updated",
        displayId,
        reason: "heartbeat",
        timestamp: now.toISOString(),
      });
      return c.body(null, 204);
    },
  );

  return router;
};
