import {
  createHash,
  createHmac,
  createPublicKey,
  randomUUID,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { ValidationError } from "#/application/errors/validation";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type DisplayAuthNonceRepository,
  type DisplayKeyRepository,
  type DisplayPairingSessionRepository,
  type DisplayStateTransitionRepository,
} from "#/application/ports/display-auth";
import { type DisplayPairingCodeRepository } from "#/application/ports/display-pairing";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type SystemSettingRepository } from "#/application/ports/settings";
import { GetDisplayManifestUseCase } from "#/application/use-cases/displays";
import { db } from "#/infrastructure/db/client";
import { displays } from "#/infrastructure/db/schema/display.sql";
import { displayKeys } from "#/infrastructure/db/schema/display-key.sql";
import { displayPairingSessions } from "#/infrastructure/db/schema/display-pairing-session.sql";
import { displayStateTransitions } from "#/infrastructure/db/schema/display-state-transition.sql";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  conflict,
  notFound,
  type ResponseContext,
  unauthorized,
  validationError,
} from "#/interfaces/http/responses";
import {
  publishDisplayStreamEvent,
  subscribeToDisplayStream,
} from "#/interfaces/http/routes/displays/stream";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";

const PAIRING_SESSION_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const SIGNED_REQUEST_SKEW_MS = 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;
const STREAM_HEARTBEAT_INTERVAL_MS = 20 * 1000;

const registrationSessionBodySchema = z.object({
  registrationCode: z.string().regex(/^\d{6}$/),
});

const displayRegistrationBodySchema = z.object({
  registrationSessionId: z.string().uuid(),
  displaySlug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  displayName: z.string().min(1).max(255),
  resolutionWidth: z.number().int().positive(),
  resolutionHeight: z.number().int().positive(),
  displayOutput: z.string().min(1).max(64),
  displayFingerprint: z.string().min(16).max(255),
  publicKey: z.string().min(1).max(4096),
  keyAlgorithm: z.literal("ed25519"),
  registrationSignature: z.string().min(1),
});

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

class DisplayConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisplayConflictError";
  }
}

const isDuplicateIndexError = (error: unknown, indexName: string): boolean => {
  if (!(error instanceof Error)) return false;
  const dbError = error as {
    code?: string;
    message?: string;
    sqlMessage?: string;
  };
  const details = [dbError.message, dbError.sqlMessage]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return (
    dbError.code === "ER_DUP_ENTRY" && details.includes(indexName.toLowerCase())
  );
};

const hashPairingCode = (code: string): string =>
  createHash("sha256").update(code).digest("hex");

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

const buildRegistrationPayload = (input: {
  registrationSessionId: string;
  challengeNonce: string;
  displaySlug: string;
  displayOutput: string;
  displayFingerprint: string;
  publicKey: string;
}): string =>
  [
    "REGISTRATION",
    input.registrationSessionId,
    input.challengeNonce,
    input.displaySlug,
    input.displayOutput,
    input.displayFingerprint,
    input.publicKey,
  ].join("\n");

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
  repositories: {
    displayRepository: DisplayRepository;
    scheduleRepository: ScheduleRepository;
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    systemSettingRepository: SystemSettingRepository;
    displayPairingCodeRepository: DisplayPairingCodeRepository;
    displayPairingSessionRepository: DisplayPairingSessionRepository;
    displayKeyRepository: DisplayKeyRepository;
    displayAuthNonceRepository: DisplayAuthNonceRepository;
    displayStateTransitionRepository: DisplayStateTransitionRepository;
  };
  storage: ContentStorage;
};

type DisplayVars = {
  displayId: string;
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
    if (display.registrationState !== "active") {
      return unauthorized(c, "Display is not active");
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
    "/registration-sessions",
    setAction("display.registration.session.create", {
      route: "/display/registration-sessions",
      actorType: "display",
      resourceType: "display",
    }),
    validateJson(registrationSessionBodySchema),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const consumed =
          await deps.repositories.displayPairingCodeRepository.consumeValidCode(
            {
              codeHash: hashPairingCode(payload.registrationCode),
              now: new Date(),
            },
          );
        if (!consumed) {
          throw new ValidationError(
            "Registration code is invalid, expired, or already used",
          );
        }

        const expiresAt = new Date(Date.now() + PAIRING_SESSION_TTL_MS);
        const session =
          await deps.repositories.displayPairingSessionRepository.create({
            pairingCodeId: consumed.id,
            challengeNonce: randomUUID(),
            challengeExpiresAt: expiresAt,
          });

        return c.json(
          {
            registrationSessionId: session.id,
            expiresAt: session.challengeExpiresAt,
            challengeNonce: session.challengeNonce,
            constraints: {
              displaySlugPattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
              minSlugLength: 3,
              maxSlugLength: 120,
            },
          },
          201,
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/registrations",
    setAction("display.registration.create", {
      route: "/display/registrations",
      actorType: "display",
      resourceType: "display",
    }),
    validateJson(displayRegistrationBodySchema),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const now = new Date();
        const session =
          await deps.repositories.displayPairingSessionRepository.findOpenById({
            id: payload.registrationSessionId,
            now,
          });
        if (!session) {
          throw new ValidationError(
            "Registration session is invalid or expired",
          );
        }

        const registrationPayload = buildRegistrationPayload({
          registrationSessionId: session.id,
          challengeNonce: session.challengeNonce,
          displaySlug: payload.displaySlug,
          displayOutput: payload.displayOutput,
          displayFingerprint: payload.displayFingerprint,
          publicKey: payload.publicKey,
        });

        const isRegistrationSignatureValid = verifyEd25519Signature({
          publicKeyPem: payload.publicKey,
          payload: registrationPayload,
          signatureBase64Url: payload.registrationSignature,
        });
        if (!isRegistrationSignatureValid) {
          return unauthorized(c, "Registration signature is invalid");
        }

        const findBySlug = deps.repositories.displayRepository.findBySlug?.bind(
          deps.repositories.displayRepository,
        );
        if (!findBySlug) {
          throw new Error("Display repository does not support slug lookup");
        }
        const findByFingerprintAndOutput =
          deps.repositories.displayRepository.findByFingerprintAndOutput?.bind(
            deps.repositories.displayRepository,
          );
        if (!findByFingerprintAndOutput) {
          throw new Error(
            "Display repository does not support fingerprint/output lookup",
          );
        }

        const existingSlug = await findBySlug(payload.displaySlug);
        if (existingSlug) {
          throw new DisplayConflictError("Display slug already exists");
        }

        const existingFingerprintOutput = await findByFingerprintAndOutput(
          payload.displayFingerprint,
          payload.displayOutput,
        );
        if (existingFingerprintOutput) {
          throw new DisplayConflictError(
            "Display fingerprint/output combination already exists",
          );
        }

        let registered: {
          displayId: string;
          displaySlug: string;
          keyId: string;
          state: "registered";
        } | null = null;
        try {
          registered = await db.transaction(async (tx) => {
            const openSession = await tx
              .select()
              .from(displayPairingSessions)
              .where(
                and(
                  eq(displayPairingSessions.id, session.id),
                  eq(displayPairingSessions.state, "open"),
                  gt(displayPairingSessions.challengeExpiresAt, now),
                ),
              )
              .limit(1);
            if (!openSession[0]) {
              throw new ValidationError(
                "Registration session is invalid or expired",
              );
            }

            const displayId = randomUUID();
            const keyId = randomUUID();
            await tx.insert(displays).values({
              id: displayId,
              displaySlug: payload.displaySlug,
              name: payload.displayName,
              displayFingerprint: payload.displayFingerprint,
              registrationState: "registered",
              screenWidth: payload.resolutionWidth,
              screenHeight: payload.resolutionHeight,
              displayOutput: payload.displayOutput,
              registeredAt: now,
              createdAt: now,
              updatedAt: now,
            });
            await tx.insert(displayKeys).values({
              id: keyId,
              displayId,
              algorithm: "ed25519",
              publicKey: payload.publicKey,
              status: "active",
              createdAt: now,
              updatedAt: now,
            });
            await tx
              .update(displayPairingSessions)
              .set({ state: "completed", completedAt: now, updatedAt: now })
              .where(eq(displayPairingSessions.id, session.id));
            await tx.insert(displayStateTransitions).values({
              id: randomUUID(),
              displayId,
              fromState: "pairing_in_progress",
              toState: "registered",
              reason: "registration_completed",
              actorType: "display",
              actorId: displayId,
              createdAt: now,
            });

            return {
              displayId,
              displaySlug: payload.displaySlug,
              keyId,
              state: "registered" as const,
            };
          });
        } catch (error) {
          if (
            isDuplicateIndexError(error, "displays_display_slug_unique") ||
            isDuplicateIndexError(error, "displays_fingerprint_output_unique")
          ) {
            throw new DisplayConflictError(
              "Display slug or fingerprint/output is already registered",
            );
          }
          throw error;
        }

        if (!registered) {
          throw new Error("Display registration did not produce a result");
        }

        return c.json(registered, 201);
      },
      mapErrorToResponse(DisplayConflictError, conflict),
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/auth/challenges",
    setAction("display.auth.challenge.create", {
      route: "/display/auth/challenges",
      actorType: "display",
      resourceType: "display",
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
        if (display.registrationState === "unregistered") {
          return unauthorized(c, "Display is unregistered");
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
      route: "/display/auth/challenges/:challengeToken/verify",
      actorType: "display",
      resourceType: "display",
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
        if (display.registrationState === "unregistered") {
          return unauthorized(c, "Display is unregistered");
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

        if (display.registrationState === "registered") {
          await deps.repositories.displayRepository.setRegistrationState?.({
            id: display.id,
            state: "active",
            at: new Date(),
          });
          await deps.repositories.displayStateTransitionRepository.create({
            displayId: display.id,
            fromState: "registered",
            toState: "active",
            reason: "challenge_verified",
            actorType: "display",
            actorId: display.id,
            createdAt: new Date(),
          });
        }

        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:displaySlug/manifest",
    setAction("display.manifest.read", {
      route: "/display/:displaySlug/manifest",
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
      route: "/display/:displaySlug/stream",
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
      route: "/display/:displaySlug/heartbeat",
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
