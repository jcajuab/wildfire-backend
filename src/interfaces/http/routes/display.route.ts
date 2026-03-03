import {
  createHash,
  createHmac,
  createPublicKey,
  randomUUID,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { Hono } from "hono";
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
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type SystemSettingRepository } from "#/application/ports/settings";
import { GetDisplayManifestUseCase } from "#/application/use-cases/displays";
import { logger } from "#/infrastructure/observability/logger";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  notFound,
  type ResponseContext,
  tooManyRequests,
  unauthorized,
  validationError,
} from "#/interfaces/http/responses";
import {
  publishDisplayStreamEvent,
  subscribeToDisplayStream,
} from "#/interfaces/http/routes/displays/stream";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { type InMemoryAuthSecurityStore } from "#/interfaces/http/security/in-memory-auth-security.store";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const SIGNED_REQUEST_SKEW_MS = 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;
const STREAM_HEARTBEAT_INTERVAL_MS = 20 * 1000;

const createChallengeBodySchema = z.object({
  displaySlug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  keyId: z.string().uuid(),
});

const verifyChallengeBodySchema = z.object({
  displaySlug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  keyId: z.string().uuid(),
  signature: z.string().min(1),
});

const displaySlugParamSchema = z.object({
  displaySlug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

const challengeTokenParamSchema = z.object({
  challengeToken: z.string().min(1),
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
  displaySlug: string;
  keyId: string;
}): string =>
  ["CHALLENGE", input.challengeToken, input.displaySlug, input.keyId].join(
    "\n",
  );

const buildSignedRequestPayload = (input: {
  method: string;
  pathWithQuery: string;
  displaySlug: string;
  keyId: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
}): string =>
  [
    input.method,
    input.pathWithQuery,
    input.displaySlug,
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
  displaySlug: string;
  keyId: string;
  challengeNonce: string;
  expiresAt: Date;
  secret: string;
}): string => {
  const payload = JSON.stringify({
    id: input.challengeId,
    s: input.displaySlug,
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
  displaySlug: string;
  keyId: string;
  challengeNonce: string;
  expiresAt: string;
} | null => {
  const [encodedPayload, signature] = input.token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }
  const expected = signChallengeToken(encodedPayload, input.secret);
  if (!safeCompare(expected, signature)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      fromBase64Url(encodedPayload).toString("utf8"),
    ) as {
      id?: string;
      s?: string;
      k?: string;
      n?: string;
      e?: string;
    };

    if (
      typeof payload.id !== "string" ||
      typeof payload.s !== "string" ||
      typeof payload.k !== "string" ||
      typeof payload.n !== "string" ||
      typeof payload.e !== "string"
    ) {
      return null;
    }

    const expiresMs = Date.parse(payload.e);
    if (!Number.isFinite(expiresMs) || expiresMs <= input.now.getTime()) {
      return null;
    }

    return {
      challengeId: payload.id,
      displaySlug: payload.s,
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
  authSecurityStore: InMemoryAuthSecurityStore;
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
    systemSettingRepository: SystemSettingRepository;
    displayKeyRepository: DisplayKeyRepository;
    displayAuthNonceRepository: DisplayAuthNonceRepository;
  };
  storage: ContentStorage;
};

type DisplayVars = {
  displayId: string;
};

const resolveClientIp = (headers: {
  forwardedFor?: string;
  realIp?: string;
}): string => {
  const forwarded = headers.forwardedFor?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers.realIp?.trim() || "unknown";
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
      forwardedFor: c.req.header("x-forwarded-for"),
      realIp: c.req.header("x-real-ip"),
    });
    const key = `${input.keyPrefix}|${ip}`;
    const stats = deps.authSecurityStore.consumeEndpointAttemptWithStats({
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
    const params = displaySlugParamSchema.safeParse(c.req.param());
    if (!params.success) {
      return validationError(c, "Invalid display slug");
    }
    const slug = params.data.displaySlug;

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

    const displayRepo = deps.repositories.displayRepository;
    const findBySlug = displayRepo.findBySlug?.bind(displayRepo);
    if (!findBySlug) {
      return unauthorized(c, "Display repository does not support slug lookup");
    }

    const display = await findBySlug(slug);
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
      displaySlug: slug,
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
    systemSettingRepository: deps.repositories.systemSettingRepository,
    downloadUrlExpiresInSeconds: deps.downloadUrlExpiresInSeconds,
    scheduleTimeZone: deps.scheduleTimeZone,
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
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const findBySlug = deps.repositories.displayRepository.findBySlug?.bind(
          deps.repositories.displayRepository,
        );
        if (!findBySlug) {
          throw new Error("Display repository does not support slug lookup");
        }
        const display = await findBySlug(payload.displaySlug);
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
          displaySlug: payload.displaySlug,
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
          challenge.displaySlug !== payload.displaySlug ||
          challenge.keyId !== payload.keyId
        ) {
          return unauthorized(c, "Challenge context mismatch");
        }

        const findBySlug = deps.repositories.displayRepository.findBySlug?.bind(
          deps.repositories.displayRepository,
        );
        if (!findBySlug) {
          throw new Error("Display repository does not support slug lookup");
        }
        const display = await findBySlug(payload.displaySlug);
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
          displaySlug: payload.displaySlug,
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
    "/:displaySlug/manifest",
    setAction("display.manifest.read", {
      route: "/display-runtime/:displaySlug/manifest",
      actorType: "display",
      resourceType: "display",
    }),
    signedDisplayRequest(deps),
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
    "/:displaySlug/stream",
    setAction("display.stream.read", {
      route: "/display-runtime/:displaySlug/stream",
      actorType: "display",
      resourceType: "display",
    }),
    signedDisplayRequest(deps),
    async (c) => {
      const displayId = String(c.get("displayId"));
      const encoder = new TextEncoder();
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `event: connected\ndata: ${JSON.stringify({ displayId, timestamp: new Date().toISOString() })}\n\n`,
            ),
          );
          unsubscribe = subscribeToDisplayStream(displayId, (event) => {
            controller.enqueue(
              encoder.encode(
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
          });
          heartbeat = setInterval(() => {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }, STREAM_HEARTBEAT_INTERVAL_MS);
        },
        cancel() {
          if (unsubscribe) unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
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
    "/:displaySlug/heartbeat",
    setAction("display.heartbeat", {
      route: "/display-runtime/:displaySlug/heartbeat",
      actorType: "display",
      resourceType: "display",
    }),
    signedDisplayRequest(deps),
    async (c) => {
      const displayId = String(c.get("displayId"));
      await deps.repositories.displayRepository.touchSeen?.(
        displayId,
        new Date(),
      );
      publishDisplayStreamEvent({
        type: "manifest_updated",
        displayId,
        reason: "heartbeat",
        timestamp: new Date().toISOString(),
      });
      return c.body(null, 204);
    },
  );

  return router;
};
