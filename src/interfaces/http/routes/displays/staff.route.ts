import {
  createHash,
  createPublicKey,
  randomInt,
  randomUUID,
  verify,
} from "node:crypto";
import { type MiddlewareHandler } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { ValidationError } from "#/application/errors/validation";
import { DisplayGroupConflictError } from "#/application/use-cases/displays";
import { DisplayPairingCodeCollisionError } from "#/infrastructure/db/repositories/display-pairing-code.repo";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  conflict,
  errorResponseSchema,
  notFound,
  toApiListResponse,
  toApiResponse,
} from "#/interfaces/http/responses";
import {
  publishAdminDisplayLifecycleEvent,
  subscribeToAdminDisplayLifecycleEvents,
} from "#/interfaces/http/routes/displays/admin-lifecycle-events";
import { RedisDisplayRegistrationAttemptStore } from "#/interfaces/http/routes/displays/registration-attempt.store";
import {
  publishRegistrationAttemptEvent,
  subscribeToRegistrationAttemptEvents,
} from "#/interfaces/http/routes/displays/registration-attempt-events";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  createDisplayGroupRequestBodySchema,
  createDisplayGroupSchema,
  displayGroupIdParamSchema,
  displayGroupListResponseSchema,
  displayGroupSchema,
  displayIdParamSchema,
  displayListQuerySchema,
  displayListResponseSchema,
  displayRuntimeOverridesSchema,
  displaySchema,
  patchDisplayRequestBodySchema,
  patchDisplaySchema,
  runtimeOverrideEmergencyActionBodySchema,
  runtimeOverrideEmergencyActionSchema,
  setDisplayGroupsRequestBodySchema,
  setDisplayGroupsSchema,
  updateDisplayGroupRequestBodySchema,
  updateDisplayGroupSchema,
} from "#/interfaces/http/validators/displays.schema";
import {
  validateJson,
  validateParams,
  validateQuery,
} from "#/interfaces/http/validators/standard-validator";
import {
  type DisplaysRouter,
  type DisplaysRouterDeps,
  type DisplaysRouterUseCases,
  displayTags,
} from "./shared";

type AuthorizePermission = (
  permission: string,
) => readonly [
  MiddlewareHandler,
  MiddlewareHandler<{ Variables: JwtUserVariables }>,
];

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const REGISTRATION_ATTEMPT_HEARTBEAT_INTERVAL_MS = 20 * 1000;
const DISPLAY_EVENTS_HEARTBEAT_INTERVAL_MS = 20 * 1000;
const DISPLAY_REGISTRATION_CONSTRAINTS = {
  slugPattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  minSlugLength: 3,
  maxSlugLength: 120,
} as const;
const DISPLAY_REGISTRATION_SLUG_REGEX = new RegExp(
  DISPLAY_REGISTRATION_CONSTRAINTS.slugPattern,
);

const registrationAttemptParamSchema = z.object({
  attemptId: z.string().uuid(),
});

const registrationSessionBodySchema = z.object({
  registrationCode: z.string().regex(/^\d{6}$/),
});

const displayRegistrationBodySchema = z.object({
  registrationSessionId: z.string().uuid(),
  slug: z
    .string()
    .min(DISPLAY_REGISTRATION_CONSTRAINTS.minSlugLength)
    .max(DISPLAY_REGISTRATION_CONSTRAINTS.maxSlugLength)
    .regex(DISPLAY_REGISTRATION_SLUG_REGEX),
  displayName: z.string().min(1).max(255),
  resolutionWidth: z.number().int().positive(),
  resolutionHeight: z.number().int().positive(),
  output: z.string().min(1).max(64),
  fingerprint: z.string().min(16).max(255),
  publicKey: z.string().min(1).max(4096),
  keyAlgorithm: z.literal("ed25519"),
  registrationSignature: z.string().min(1),
});

const registrationAttemptResponseSchema = z.object({
  attemptId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  expiresAt: z.string(),
});

const registrationAttemptRotateResponseSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  expiresAt: z.string(),
});

const registrationSessionResponseSchema = z.object({
  registrationSessionId: z.string().uuid(),
  expiresAt: z.string(),
  challengeNonce: z.string().uuid(),
  constraints: z.object({
    slugPattern: z.string(),
    minSlugLength: z.number().int().positive(),
    maxSlugLength: z.number().int().positive(),
  }),
});

const displayRegistrationConstraintsResponseSchema = z.object({
  slugPattern: z.string(),
  minSlugLength: z.number().int().positive(),
  maxSlugLength: z.number().int().positive(),
});

const displayRegistrationResponseSchema = z.object({
  displayId: z.string().uuid(),
  slug: z.string(),
  keyId: z.string().uuid(),
  state: z.literal("registered"),
});

class DisplayConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisplayConflictError";
  }
}

const hashPairingCode = (code: string): string =>
  createHash("sha256").update(code).digest("hex");

const fromBase64Url = (value: string): Buffer => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, "base64");
};

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

const buildRegistrationPayload = (input: {
  registrationSessionId: string;
  challengeNonce: string;
  slug: string;
  output: string;
  fingerprint: string;
  publicKey: string;
}): string =>
  [
    "REGISTRATION",
    input.registrationSessionId,
    input.challengeNonce,
    input.slug,
    input.output,
    input.fingerprint,
    input.publicKey,
  ].join("\n");

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

const issuePairingCode = async (input: {
  deps: DisplaysRouterDeps;
  createdById: string;
}): Promise<{
  code: string;
  codeHash: string;
  pairingCodeId: string;
  expiresAt: Date;
}> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
    const codeHash = hashPairingCode(code);
    try {
      const created =
        await input.deps.repositories.displayPairingCodeRepository.create({
          codeHash,
          expiresAt,
          createdById: input.createdById,
        });
      return {
        code,
        codeHash,
        pairingCodeId: created.id,
        expiresAt,
      };
    } catch (error) {
      if (!(error instanceof DisplayPairingCodeCollisionError)) {
        throw error;
      }
    }
  }
  throw new Error("Failed to generate a unique pairing code");
};

const createSseResponse = (stream: ReadableStream<Uint8Array>): Response =>
  new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });

const closeStreamController = (
  streamController: ReadableStreamDefaultController<Uint8Array> | null,
): void => {
  if (!streamController) {
    return;
  }

  try {
    streamController.close();
  } catch {
    // Ignore repeated close attempts after stream teardown.
  }
};

export const registerDisplayStaffRoutes = (args: {
  router: DisplaysRouter;
  useCases: DisplaysRouterUseCases;
  authorize: AuthorizePermission;
  deps: DisplaysRouterDeps;
}) => {
  const { router, useCases, authorize, deps } = args;
  const registrationAttemptStore =
    deps.registrationAttemptStore ?? new RedisDisplayRegistrationAttemptStore();

  router.get(
    "/events",
    setAction("displays.events.stream", {
      route: "/displays/events",
      resourceType: "display",
    }),
    ...authorize("displays:read"),
    describeRoute({
      description: "Stream display lifecycle events for admin dashboards",
      tags: displayTags,
      responses: {
        200: {
          description:
            "Server-sent events stream for display lifecycle updates",
          content: {
            "text/event-stream": {
              schema: {
                type: "string",
              },
            },
          },
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
      },
    }),
    async () => {
      const encoder = new TextEncoder();
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let isClosed = false;
      let streamController: ReadableStreamDefaultController<Uint8Array> | null =
        null;

      const safeEnqueue = (frame: string | Uint8Array): void => {
        if (isClosed || !streamController) {
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
          closeStreamController(streamController);
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

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          safeEnqueue(
            `event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`,
          );
          unsubscribe = subscribeToAdminDisplayLifecycleEvents((event) => {
            safeEnqueue(
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            );
          });
          heartbeat = setInterval(() => {
            safeEnqueue(": heartbeat\n\n");
          }, DISPLAY_EVENTS_HEARTBEAT_INTERVAL_MS);
        },
        cancel() {
          closeStream();
          closeStreamController(streamController);
        },
      });

      return createSseResponse(stream);
    },
  );

  router.get(
    "/registration-attempts/:attemptId/events",
    setAction("displays.registration-attempt.events", {
      route: "/displays/registration-attempts/:attemptId/events",
      resourceType: "display",
    }),
    ...authorize("displays:create"),
    validateParams(registrationAttemptParamSchema),
    describeRoute({
      description: "Stream registration attempt events via SSE",
      tags: displayTags,
      responses: {
        200: {
          description: "Server-sent events stream for a registration attempt",
          content: {
            "text/event-stream": {
              schema: {
                type: "string",
              },
            },
          },
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        404: {
          ...notFoundResponse,
        },
        422: {
          ...validationErrorResponse,
        },
      },
    }),
    async (c) => {
      const params = c.req.valid("param");
      const userId = c.get("userId");
      if (
        !(await registrationAttemptStore.isAttemptOwnedBy({
          attemptId: params.attemptId,
          createdById: userId,
        }))
      ) {
        return notFound(c, "Registration attempt not found");
      }

      const encoder = new TextEncoder();
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let isClosed = false;
      let streamController: ReadableStreamDefaultController<Uint8Array> | null =
        null;

      const safeEnqueue = (frame: string | Uint8Array): void => {
        if (isClosed || !streamController) {
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
          closeStreamController(streamController);
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

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          safeEnqueue(
            `event: connected\ndata: ${JSON.stringify({ attemptId: params.attemptId, timestamp: new Date().toISOString() })}\n\n`,
          );
          unsubscribe = subscribeToRegistrationAttemptEvents(
            params.attemptId,
            (event) => {
              safeEnqueue(
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              );
            },
          );
          heartbeat = setInterval(() => {
            safeEnqueue(": heartbeat\n\n");
          }, REGISTRATION_ATTEMPT_HEARTBEAT_INTERVAL_MS);
        },
        cancel() {
          closeStream();
          closeStreamController(streamController);
        },
      });

      return createSseResponse(stream);
    },
  );

  router.post(
    "/registration-attempts",
    setAction("displays.registration-attempt.create", {
      route: "/displays/registration-attempts",
      resourceType: "display",
    }),
    ...authorize("displays:create"),
    describeRoute({
      description: "Create or replace an active display registration attempt",
      tags: displayTags,
      responses: {
        201: {
          description: "Registration attempt issued",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(registrationAttemptResponseSchema),
              ),
            },
          },
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const createdById = c.get("userId");
        const issued = await issuePairingCode({
          deps,
          createdById,
        });
        const created =
          await registrationAttemptStore.createOrReplaceOpenAttempt({
            createdById,
            activeCode: {
              code: issued.code,
              codeHash: issued.codeHash,
              pairingCodeId: issued.pairingCodeId,
              expiresAt: issued.expiresAt,
            },
          });

        if (created.invalidatedPairingCodeId) {
          await deps.repositories.displayPairingCodeRepository.invalidateById({
            id: created.invalidatedPairingCodeId,
            now: new Date(),
          });
        }

        c.header(
          "Location",
          `${c.req.path}/${encodeURIComponent(created.attemptId)}`,
        );
        return c.json(
          toApiResponse({
            attemptId: created.attemptId,
            code: issued.code,
            expiresAt: issued.expiresAt.toISOString(),
          }),
          201,
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/registration-attempts/:attemptId/rotate",
    setAction("displays.registration-attempt.rotate", {
      route: "/displays/registration-attempts/:attemptId/rotate",
      resourceType: "display",
    }),
    ...authorize("displays:create"),
    validateParams(registrationAttemptParamSchema),
    describeRoute({
      description:
        "Rotate the one-time code for an active registration attempt",
      tags: displayTags,
      responses: {
        200: {
          description: "Registration code rotated",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(registrationAttemptRotateResponseSchema),
              ),
            },
          },
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        404: {
          ...notFoundResponse,
        },
        422: {
          ...validationErrorResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const createdById = c.get("userId");
        const issued = await issuePairingCode({
          deps,
          createdById,
        });
        const rotated = await registrationAttemptStore.rotateCode({
          attemptId: params.attemptId,
          createdById,
          nextCode: {
            code: issued.code,
            codeHash: issued.codeHash,
            pairingCodeId: issued.pairingCodeId,
            expiresAt: issued.expiresAt,
          },
        });
        if (!rotated) {
          return notFound(c, "Registration attempt not found");
        }

        if (rotated.invalidatedPairingCodeId) {
          await deps.repositories.displayPairingCodeRepository.invalidateById({
            id: rotated.invalidatedPairingCodeId,
            now: new Date(),
          });
        }

        return c.json(
          toApiResponse({
            code: issued.code,
            expiresAt: issued.expiresAt.toISOString(),
          }),
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/registration-attempts/:attemptId",
    setAction("displays.registration-attempt.close", {
      route: "/displays/registration-attempts/:attemptId",
      resourceType: "display",
    }),
    ...authorize("displays:create"),
    validateParams(registrationAttemptParamSchema),
    describeRoute({
      description: "Close an active registration attempt",
      tags: displayTags,
      responses: {
        204: {
          description: "Registration attempt closed",
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        404: {
          ...notFoundResponse,
        },
        422: {
          ...validationErrorResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const closed = await registrationAttemptStore.closeAttempt({
          attemptId: params.attemptId,
          createdById: c.get("userId"),
        });
        if (!closed) {
          return notFound(c, "Registration attempt not found");
        }
        if (closed.invalidatedPairingCodeId) {
          await deps.repositories.displayPairingCodeRepository.invalidateById({
            id: closed.invalidatedPairingCodeId,
            now: new Date(),
          });
        }
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/registration-constraints",
    setAction("displays.registration-constraints.read", {
      route: "/displays/registration-constraints",
      resourceType: "display",
    }),
    ...authorize("displays:create"),
    describeRoute({
      description: "Get backend registration constraints for display slugs",
      tags: displayTags,
      responses: {
        200: {
          description: "Registration constraints",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(displayRegistrationConstraintsResponseSchema),
              ),
            },
          },
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
      },
    }),
    withRouteErrorHandling(async (c) => {
      return c.json(toApiResponse(DISPLAY_REGISTRATION_CONSTRAINTS));
    }),
  );

  router.post(
    "/registration-sessions",
    setAction("displays.registration-session.create", {
      route: "/displays/registration-sessions",
      resourceType: "display",
    }),
    ...authorize("displays:create"),
    validateJson(registrationSessionBodySchema),
    describeRoute({
      description: "Create a display registration session from a pairing code",
      tags: displayTags,
      responses: {
        201: {
          description: "Registration session created",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(registrationSessionResponseSchema),
              ),
            },
          },
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        422: {
          ...validationErrorResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const now = new Date();
        const codeHash = hashPairingCode(payload.registrationCode);
        const consumedAttempt = await registrationAttemptStore.consumeCodeHash({
          codeHash,
          now,
        });
        if (!consumedAttempt) {
          throw new ValidationError(
            "Registration code is invalid, expired, or already used",
          );
        }

        const consumed =
          await deps.repositories.displayPairingCodeRepository.consumeValidCode(
            {
              codeHash,
              now,
            },
          );
        if (!consumed || consumed.id !== consumedAttempt.pairingCodeId) {
          throw new ValidationError(
            "Registration code is invalid, expired, or already used",
          );
        }

        const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
        const session =
          await deps.repositories.displayPairingSessionRepository.create({
            pairingCodeId: consumed.id,
            challengeNonce: randomUUID(),
            challengeExpiresAt: expiresAt,
          });

        await registrationAttemptStore.bindSessionAttempt({
          sessionId: session.id,
          attemptId: consumedAttempt.attemptId,
        });

        c.header("Location", `${c.req.path}/${encodeURIComponent(session.id)}`);
        return c.json(
          toApiResponse({
            registrationSessionId: session.id,
            expiresAt: session.challengeExpiresAt,
            challengeNonce: session.challengeNonce,
            constraints: DISPLAY_REGISTRATION_CONSTRAINTS,
          }),
          201,
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/registrations",
    setAction("displays.registration.create", {
      route: "/displays/registrations",
      resourceType: "display",
    }),
    ...authorize("displays:create"),
    validateJson(displayRegistrationBodySchema),
    describeRoute({
      description: "Register a display using a valid registration session",
      tags: displayTags,
      responses: {
        201: {
          description: "Display registered",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(displayRegistrationResponseSchema),
              ),
            },
          },
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        409: {
          description: "Display registration conflict",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        422: {
          ...validationErrorResponse,
        },
      },
    }),
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
          slug: payload.slug,
          output: payload.output,
          fingerprint: payload.fingerprint,
          publicKey: payload.publicKey,
        });

        const isRegistrationSignatureValid = verifyEd25519Signature({
          publicKeyPem: payload.publicKey,
          payload: registrationPayload,
          signatureBase64Url: payload.registrationSignature,
        });
        if (!isRegistrationSignatureValid) {
          throw new ValidationError("Registration signature is invalid");
        }

        const normalizedOutput = payload.output.trim().toLowerCase();
        if (normalizedOutput.length === 0) {
          throw new ValidationError("Display output is required");
        }

        const [existingSlug, existingFingerprintOutput] = await Promise.all([
          deps.repositories.displayRepository.findBySlug(payload.slug),
          deps.repositories.displayRepository.findByFingerprintAndOutput(
            payload.fingerprint,
            normalizedOutput,
          ),
        ]);

        if (
          existingSlug ||
          existingFingerprintOutput ||
          payload.slug.trim().length === 0
        ) {
          throw new DisplayConflictError(
            "Display slug or fingerprint/output already exists",
          );
        }

        const consumedSession =
          await deps.repositories.displayPairingSessionRepository.complete(
            session.id,
            now,
          );
        if (!consumedSession) {
          throw new ValidationError(
            "Registration session is invalid or expired",
          );
        }

        let registered: {
          displayId: string;
          slug: string;
          keyId: string;
          state: "registered";
        } | null = null;
        try {
          const createdDisplay =
            await deps.repositories.displayRepository.createRegisteredDisplay({
              slug: payload.slug,
              name: payload.displayName,
              fingerprint: payload.fingerprint,
              output: normalizedOutput,
              screenWidth: payload.resolutionWidth,
              screenHeight: payload.resolutionHeight,
              now,
            });
          let createdKey: { id: string } | null = null;
          try {
            createdKey = await deps.repositories.displayKeyRepository.create({
              displayId: createdDisplay.id,
              algorithm: "ed25519",
              publicKey: payload.publicKey,
            });
          } catch (error) {
            await deps.repositories.displayRepository.delete(createdDisplay.id);
            throw error;
          }
          if (!createdKey) {
            throw new Error("Display key creation failed");
          }

          registered = {
            displayId: createdDisplay.id,
            slug: createdDisplay.slug,
            keyId: createdKey.id,
            state: "registered",
          };
        } catch (error) {
          if (
            isDuplicateIndexError(error, "displays_slug_unique") ||
            isDuplicateIndexError(
              error,
              "displays_fingerprint_output_unique",
            ) ||
            isDuplicateIndexError(error, "display_keys_display_id_unique")
          ) {
            throw new DisplayConflictError(
              "Display slug, fingerprint/output, or key already exists",
            );
          }
          throw error;
        }

        if (!registered) {
          throw new Error("Display registration did not produce a result");
        }

        const attemptId =
          await registrationAttemptStore.consumeSessionAttemptId(
            payload.registrationSessionId,
          );
        if (attemptId) {
          publishRegistrationAttemptEvent({
            type: "registration_succeeded",
            attemptId,
            displayId: registered.displayId,
            slug: registered.slug,
            occurredAt: new Date().toISOString(),
          });
        }
        publishAdminDisplayLifecycleEvent({
          type: "display_registered",
          displayId: registered.displayId,
          slug: registered.slug,
          occurredAt: new Date().toISOString(),
        });

        c.header(
          "Location",
          `/api/v1/displays/${encodeURIComponent(registered.displayId)}`,
        );
        return c.json(toApiResponse(registered), 201);
      },
      mapErrorToResponse(DisplayConflictError, conflict),
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/runtime-overrides",
    setAction("displays.runtime-overrides.get", {
      route: "/displays/runtime-overrides",
      resourceType: "display",
    }),
    ...authorize("displays:read"),
    describeRoute({
      description: "Get global emergency and active flash runtime overrides",
      tags: displayTags,
      responses: {
        200: {
          description: "Runtime overrides",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(displayRuntimeOverridesSchema),
              ),
            },
          },
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const result = await useCases.getRuntimeOverrides.execute({
          now: new Date(),
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/runtime-overrides/emergency/activate",
    setAction("displays.runtime-overrides.emergency.activate", {
      route: "/displays/runtime-overrides/emergency/activate",
      resourceType: "display",
    }),
    ...authorize("displays:update"),
    validateJson(runtimeOverrideEmergencyActionSchema),
    describeRoute({
      description: "Activate global emergency mode",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: runtimeOverrideEmergencyActionBodySchema,
          },
        },
        required: true,
      },
      responses: {
        204: { description: "Global emergency mode activated" },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        422: {
          ...validationErrorResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        await useCases.activateGlobalEmergency.execute({
          reason: payload.reason,
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/runtime-overrides/emergency/deactivate",
    setAction("displays.runtime-overrides.emergency.deactivate", {
      route: "/displays/runtime-overrides/emergency/deactivate",
      resourceType: "display",
    }),
    ...authorize("displays:update"),
    validateJson(runtimeOverrideEmergencyActionSchema),
    describeRoute({
      description: "Deactivate global emergency mode",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: runtimeOverrideEmergencyActionBodySchema,
          },
        },
        required: true,
      },
      responses: {
        204: { description: "Global emergency mode deactivated" },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        422: {
          ...validationErrorResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        await useCases.deactivateGlobalEmergency.execute({
          reason: payload.reason,
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/:id{[0-9a-fA-F-]{36}}/emergency/activate",
    setAction("displays.display.emergency.activate", {
      route: "/displays/:id/emergency/activate",
      resourceType: "display",
    }),
    ...authorize("displays:update"),
    validateParams(displayIdParamSchema),
    validateJson(runtimeOverrideEmergencyActionSchema),
    describeRoute({
      description: "Activate emergency mode for a display",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: runtimeOverrideEmergencyActionBodySchema,
          },
        },
        required: true,
      },
      responses: {
        204: { description: "Display emergency mode activated" },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        404: {
          ...notFoundResponse,
        },
        422: {
          ...validationErrorResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        c.set("resourceId", params.id);
        await useCases.activateDisplayEmergency.execute({
          displayId: params.id,
          reason: payload.reason,
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/:id{[0-9a-fA-F-]{36}}/emergency/deactivate",
    setAction("displays.display.emergency.deactivate", {
      route: "/displays/:id/emergency/deactivate",
      resourceType: "display",
    }),
    ...authorize("displays:update"),
    validateParams(displayIdParamSchema),
    validateJson(runtimeOverrideEmergencyActionSchema),
    describeRoute({
      description: "Deactivate emergency mode for a display",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: runtimeOverrideEmergencyActionBodySchema,
          },
        },
        required: true,
      },
      responses: {
        204: { description: "Display emergency mode deactivated" },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        404: {
          ...notFoundResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        c.set("resourceId", params.id);
        await useCases.deactivateDisplayEmergency.execute({
          displayId: params.id,
          reason: payload.reason,
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/",
    setAction("displays.display.list", { route: "/displays" }),
    ...authorize("displays:read"),
    validateQuery(displayListQuerySchema),
    describeRoute({
      description: "List displays",
      tags: displayTags,
      responses: {
        200: {
          description: "Displays list",
          content: {
            "application/json": {
              schema: resolver(displayListResponseSchema),
            },
          },
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const query = c.req.valid("query");
        const result = await useCases.listDisplays.execute({
          page: query.page,
          pageSize: query.pageSize,
        });
        return c.json(
          toApiListResponse({
            items: result.items,
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            requestUrl: c.req.url,
          }),
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:id{[0-9a-fA-F-]{36}}",
    setAction("displays.display.get", {
      route: "/displays/:id",
      resourceType: "display",
    }),
    ...authorize("displays:read"),
    validateParams(displayIdParamSchema),
    describeRoute({
      description: "Get display",
      tags: displayTags,
      responses: {
        200: {
          description: "Display details",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(displaySchema)),
            },
          },
        },
        404: {
          ...notFoundResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const result = await useCases.getDisplay.execute({ id: params.id });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  router.patch(
    "/:id{[0-9a-fA-F-]{36}}",
    setAction("displays.display.update", {
      route: "/displays/:id",
      resourceType: "display",
    }),
    ...authorize("displays:update"),
    validateParams(displayIdParamSchema),
    validateJson(patchDisplaySchema),
    describeRoute({
      description: "Update display",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: patchDisplayRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Updated display",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(displaySchema)),
            },
          },
        },
        422: {
          ...validationErrorResponse,
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        404: {
          ...notFoundResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        c.set("resourceId", params.id);
        const result = await useCases.updateDisplay.execute({
          id: params.id,
          name: payload.name,
          location: payload.location,
          ipAddress: payload.ipAddress,
          macAddress: payload.macAddress,
          screenWidth: payload.screenWidth,
          screenHeight: payload.screenHeight,
          output: payload.output,
          orientation: payload.orientation,
          emergencyContentId: payload.emergencyContentId,
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/:id{[0-9a-fA-F-]{36}}/refresh",
    setAction("displays.display.refresh", {
      route: "/displays/:id/refresh",
      resourceType: "display",
    }),
    ...authorize("displays:update"),
    validateParams(displayIdParamSchema),
    describeRoute({
      description: "Queue a refresh signal for a display",
      tags: displayTags,
      responses: {
        204: { description: "Refresh queued" },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        404: {
          ...notFoundResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        await useCases.requestDisplayRefresh.execute({ id: params.id });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/:id{[0-9a-fA-F-]{36}}/unregister",
    setAction("displays.display.unregister", {
      route: "/displays/:id/unregister",
      resourceType: "display",
    }),
    ...authorize("displays:delete"),
    validateParams(displayIdParamSchema),
    describeRoute({
      description: "Unregister display and revoke display authentication",
      tags: displayTags,
      responses: {
        204: { description: "Display unregistered" },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        404: {
          ...notFoundResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        await useCases.unregisterDisplay.execute({
          id: params.id,
          actorId: c.get("userId"),
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/groups",
    setAction("displays.group.list", {
      route: "/displays/groups",
      resourceType: "display-group",
    }),
    ...authorize("displays:read"),
    describeRoute({
      description: "List display groups",
      tags: displayTags,
      responses: {
        200: {
          description: "Display groups",
          content: {
            "application/json": {
              schema: resolver(displayGroupListResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const items = await useCases.listDisplayGroups.execute();
        return c.json(
          toApiListResponse({
            items,
            total: items.length,
            page: 1,
            pageSize: Math.max(1, items.length),
            requestUrl: c.req.url,
          }),
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/groups",
    setAction("displays.group.create", {
      route: "/displays/groups",
      resourceType: "display-group",
    }),
    ...authorize("displays:update"),
    validateJson(createDisplayGroupSchema),
    describeRoute({
      description: "Create display group",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: createDisplayGroupRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        201: {
          description: "Display group created",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(displayGroupSchema)),
            },
          },
        },
        409: {
          description: "Group name already exists",
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const result = await useCases.createDisplayGroup.execute({
          name: payload.name,
          colorIndex: payload.colorIndex,
        });
        c.set("resourceId", result.id);
        c.header("Location", `${c.req.path}/${encodeURIComponent(result.id)}`);
        return c.json(toApiResponse(result), 201);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(DisplayGroupConflictError, conflict),
    ),
  );

  router.patch(
    "/groups/:groupId",
    setAction("displays.group.update", {
      route: "/displays/groups/:groupId",
      resourceType: "display-group",
    }),
    ...authorize("displays:update"),
    validateParams(displayGroupIdParamSchema),
    validateJson(updateDisplayGroupSchema),
    describeRoute({
      description: "Update display group",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: updateDisplayGroupRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Display group",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(displayGroupSchema)),
            },
          },
        },
        409: {
          description: "Group name already exists",
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        const result = await useCases.updateDisplayGroup.execute({
          id: params.groupId,
          name: payload.name,
          colorIndex: payload.colorIndex,
        });
        c.set("resourceId", result.id);
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
      mapErrorToResponse(DisplayGroupConflictError, conflict),
    ),
  );

  router.delete(
    "/groups/:groupId",
    setAction("displays.group.delete", {
      route: "/displays/groups/:groupId",
      resourceType: "display-group",
    }),
    ...authorize("displays:update"),
    validateParams(displayGroupIdParamSchema),
    describeRoute({
      description: "Delete display group",
      tags: displayTags,
      responses: {
        204: { description: "Deleted" },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        await useCases.deleteDisplayGroup.execute({ id: params.groupId });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.put(
    "/:id{[0-9a-fA-F-]{36}}/groups",
    setAction("displays.group.set", {
      route: "/displays/:id/groups",
      resourceType: "display",
    }),
    ...authorize("displays:update"),
    validateParams(displayIdParamSchema),
    validateJson(setDisplayGroupsSchema),
    describeRoute({
      description: "Set display groups for a display",
      tags: displayTags,
      requestBody: {
        content: {
          "application/json": {
            schema: setDisplayGroupsRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        204: { description: "Updated" },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        await useCases.setDisplayGroups.execute({
          displayId: params.id,
          groupIds: payload.groupIds,
        });
        c.set("resourceId", params.id);
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
