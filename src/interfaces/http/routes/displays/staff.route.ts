import {
  createHash,
  createPublicKey,
  randomInt,
  randomUUID,
  verify,
} from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { type MiddlewareHandler } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { ValidationError } from "#/application/errors/validation";
import { DisplayGroupConflictError } from "#/application/use-cases/displays";
import { db } from "#/infrastructure/db/client";
import { displays } from "#/infrastructure/db/schema/display.sql";
import { displayKeys } from "#/infrastructure/db/schema/display-key.sql";
import { displayPairingSessions } from "#/infrastructure/db/schema/display-pairing-session.sql";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  conflict,
  notFound,
  toApiListResponse,
} from "#/interfaces/http/responses";
import {
  publishAdminDisplayLifecycleEvent,
  subscribeToAdminDisplayLifecycleEvents,
} from "#/interfaces/http/routes/displays/admin-lifecycle-events";
import { InMemoryDisplayRegistrationAttemptStore } from "#/interfaces/http/routes/displays/registration-attempt.store";
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
  displaySchema,
  patchDisplayRequestBodySchema,
  patchDisplaySchema,
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
const PAIRING_CODE_DUPLICATE_INDEX = "pairing_codes_code_hash_unique";
const REGISTRATION_ATTEMPT_HEARTBEAT_INTERVAL_MS = 20 * 1000;
const DISPLAY_EVENTS_HEARTBEAT_INTERVAL_MS = 20 * 1000;

const registrationAttemptStore = new InMemoryDisplayRegistrationAttemptStore();

const registrationAttemptParamSchema = z.object({
  attemptId: z.string().uuid(),
});

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

const isDuplicatePairingCodeError = (error: unknown): boolean => {
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
    dbError.code === "ER_DUP_ENTRY" &&
    details.includes(PAIRING_CODE_DUPLICATE_INDEX)
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
      if (!isDuplicatePairingCodeError(error)) {
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

export const registerDisplayStaffRoutes = (args: {
  router: DisplaysRouter;
  useCases: DisplaysRouterUseCases;
  authorize: AuthorizePermission;
  deps: DisplaysRouterDeps;
}) => {
  const { router, useCases, authorize, deps } = args;

  router.get(
    "/events",
    setAction("displays.events.stream", {
      route: "/displays/events",
      resourceType: "display",
    }),
    ...authorize("displays:read"),
    async () => {
      const encoder = new TextEncoder();
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`,
            ),
          );
          unsubscribe = subscribeToAdminDisplayLifecycleEvents((event) => {
            controller.enqueue(
              encoder.encode(
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
          });
          heartbeat = setInterval(() => {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }, DISPLAY_EVENTS_HEARTBEAT_INTERVAL_MS);
        },
        cancel() {
          if (unsubscribe) unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
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
    ...authorize("displays:register"),
    validateParams(registrationAttemptParamSchema),
    async (c) => {
      const params = c.req.valid("param");
      const userId = c.get("userId");
      if (
        !registrationAttemptStore.isAttemptOwnedBy({
          attemptId: params.attemptId,
          createdById: userId,
        })
      ) {
        return notFound(c, "Registration attempt not found");
      }

      const encoder = new TextEncoder();
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `event: connected\ndata: ${JSON.stringify({ attemptId: params.attemptId, timestamp: new Date().toISOString() })}\n\n`,
            ),
          );
          unsubscribe = subscribeToRegistrationAttemptEvents(
            params.attemptId,
            (event) => {
              controller.enqueue(
                encoder.encode(
                  `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
                ),
              );
            },
          );
          heartbeat = setInterval(() => {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }, REGISTRATION_ATTEMPT_HEARTBEAT_INTERVAL_MS);
        },
        cancel() {
          if (unsubscribe) unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
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
    ...authorize("displays:register"),
    withRouteErrorHandling(
      async (c) => {
        const createdById = c.get("userId");
        const issued = await issuePairingCode({
          deps,
          createdById,
        });
        const created = registrationAttemptStore.createOrReplaceOpenAttempt({
          createdById,
          activeCode: {
            code: issued.code,
            codeHash: issued.codeHash,
            pairingCodeId: issued.pairingCodeId,
            expiresAt: issued.expiresAt,
          },
        });

        if (created.invalidatedPairingCodeId) {
          await deps.repositories.displayPairingCodeRepository.invalidateById?.(
            {
              id: created.invalidatedPairingCodeId,
              now: new Date(),
            },
          );
        }

        return c.json(
          {
            attemptId: created.attemptId,
            code: issued.code,
            expiresAt: issued.expiresAt.toISOString(),
          },
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
    ...authorize("displays:register"),
    validateParams(registrationAttemptParamSchema),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const createdById = c.get("userId");
        const issued = await issuePairingCode({
          deps,
          createdById,
        });
        const rotated = registrationAttemptStore.rotateCode({
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
          await deps.repositories.displayPairingCodeRepository.invalidateById?.(
            {
              id: rotated.invalidatedPairingCodeId,
              now: new Date(),
            },
          );
        }

        return c.json({
          code: issued.code,
          expiresAt: issued.expiresAt.toISOString(),
        });
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
    ...authorize("displays:register"),
    validateParams(registrationAttemptParamSchema),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const closed = registrationAttemptStore.closeAttempt({
          attemptId: params.attemptId,
          createdById: c.get("userId"),
        });
        if (!closed) {
          return notFound(c, "Registration attempt not found");
        }
        if (closed.invalidatedPairingCodeId) {
          await deps.repositories.displayPairingCodeRepository.invalidateById?.(
            {
              id: closed.invalidatedPairingCodeId,
              now: new Date(),
            },
          );
        }
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/registration-sessions",
    setAction("displays.registration-session.create", {
      route: "/displays/registration-sessions",
      resourceType: "display",
    }),
    ...authorize("displays:register"),
    validateJson(registrationSessionBodySchema),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const now = new Date();
        const codeHash = hashPairingCode(payload.registrationCode);
        const consumedAttempt = registrationAttemptStore.consumeCodeHash({
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

        registrationAttemptStore.bindSessionAttempt({
          sessionId: session.id,
          attemptId: consumedAttempt.attemptId,
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
    setAction("displays.registration.create", {
      route: "/displays/registrations",
      resourceType: "display",
    }),
    ...authorize("displays:register"),
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
          throw new ValidationError("Registration signature is invalid");
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

        const normalizedOutput = payload.displayOutput.trim().toLowerCase();
        if (normalizedOutput.length === 0) {
          throw new ValidationError("Display output is required");
        }

        const [existingSlug, existingFingerprintOutput] = await Promise.all([
          findBySlug(payload.displaySlug),
          findByFingerprintAndOutput(
            payload.displayFingerprint,
            normalizedOutput,
          ),
        ]);

        if (
          existingSlug ||
          existingFingerprintOutput ||
          payload.displaySlug.trim().length === 0
        ) {
          throw new DisplayConflictError(
            "Display slug or fingerprint/output already exists",
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
              registrationState: "active",
              screenWidth: payload.resolutionWidth,
              screenHeight: payload.resolutionHeight,
              displayOutput: normalizedOutput,
              registeredAt: now,
              activatedAt: now,
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
            isDuplicateIndexError(
              error,
              "displays_fingerprint_output_unique",
            ) ||
            isDuplicateIndexError(error, "display_keys_display_id_unique") ||
            isDuplicateIndexError(error, "display_keys_id_unique")
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

        const attemptId = registrationAttemptStore.consumeSessionAttemptId(
          payload.registrationSessionId,
        );
        if (attemptId) {
          publishRegistrationAttemptEvent({
            type: "registration_succeeded",
            attemptId,
            displayId: registered.displayId,
            displaySlug: registered.displaySlug,
            occurredAt: new Date().toISOString(),
          });
        }
        publishAdminDisplayLifecycleEvent({
          type: "display_registered",
          displayId: registered.displayId,
          displaySlug: registered.displaySlug,
          occurredAt: new Date().toISOString(),
        });

        return c.json(registered, 201);
      },
      mapErrorToResponse(DisplayConflictError, conflict),
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
        return c.json(result);
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
          outputType: payload.outputType,
          orientation: payload.orientation,
        });
        return c.json(result);
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
    ...authorize("displays:update"),
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
        const payload = c.req.valid("json");
        const result = await useCases.createDisplayGroup.execute({
          name: payload.name,
          colorIndex: payload.colorIndex,
        });
        c.set("resourceId", result.id);
        return c.json(result);
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
        return c.json(result);
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
