import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { DISPLAY_REGISTRATION_CONSTRAINTS } from "#/application/use-cases/displays";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  errorResponseSchema,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { authValidationErrorResponses } from "#/interfaces/http/routes/shared/openapi-responses";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import { displayTags } from "../contracts";
import {
  type AuthorizePermission,
  type DisplaysRouter,
  type DisplaysRouterDeps,
  type DisplaysRouterUseCases,
} from "../module";

const registrationLinkBodySchema = z.object({
  slug: z
    .string()
    .min(DISPLAY_REGISTRATION_CONSTRAINTS.minSlugLength)
    .max(DISPLAY_REGISTRATION_CONSTRAINTS.maxSlugLength)
    .regex(new RegExp(DISPLAY_REGISTRATION_CONSTRAINTS.slugPattern)),
  displayName: z.string().min(1).max(255),
  outputType: z.string().min(1).max(64),
  outputIndex: z.number().int().min(0),
  resolutionWidth: z.number().int().positive(),
  resolutionHeight: z.number().int().positive(),
  displayGroups: z.array(z.string().min(1).max(120)).default([]),
});

const claimBodySchema = z.object({
  fingerprint: z.string().min(16).max(255),
  publicKey: z.string().min(1).max(4096),
  keyAlgorithm: z.literal("ed25519"),
  registrationSignature: z.string().min(1),
});

const tokenParamSchema = z.object({
  token: z.string().uuid(),
});

const registrationLinkResponseSchema = z.object({
  token: z.string().uuid(),
  attemptId: z.string().uuid(),
  expiresAt: z.string(),
});

const registrationLinkMetadataResponseSchema = z.object({
  slug: z.string(),
  output: z.string(),
  challengeNonce: z.string().uuid(),
  expiresAt: z.string(),
});

const claimResponseSchema = z.object({
  displayId: z.string().uuid(),
  slug: z.string(),
  keyId: z.string().uuid(),
  state: z.literal("registered"),
});

export const registerDisplayStaffRegistrationLinkRoutes = (input: {
  router: DisplaysRouter;
  useCases: DisplaysRouterUseCases;
  deps: DisplaysRouterDeps;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, deps, authorize } = input;

  // POST /registration-links — create a registration link (admin, authenticated)
  router.post(
    "/registration-links",
    setAction("displays.registration-link.create", {
      route: "/displays/registration-links",
      resourceType: "display",
    }),
    ...authorize("displays:create"),
    validateJson(registrationLinkBodySchema),
    describeRoute({
      description: "Create a registration link with pre-filled display details",
      tags: displayTags,
      responses: {
        201: {
          description: "Registration link created",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(registrationLinkResponseSchema),
              ),
            },
          },
        },
        409: {
          description: "Display registration conflict",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const userId = c.get("userId");
        const result = await useCases.issueRegistrationLink.execute({
          ownerId: userId,
          slug: payload.slug,
          displayName: payload.displayName,
          outputType: payload.outputType,
          outputIndex: payload.outputIndex,
          resolutionWidth: payload.resolutionWidth,
          resolutionHeight: payload.resolutionHeight,
          displayGroups: payload.displayGroups,
        });
        return c.json({ data: result }, 201);
      },
      ...applicationErrorMappers,
    ),
  );

  // GET /registration-links/:token — fetch link metadata (unauthenticated, token-secured)
  router.get(
    "/registration-links/:token",
    setAction("displays.registration-link.read", {
      route: "/displays/registration-links/:token",
      resourceType: "display",
    }),
    describeRoute({
      description: "Fetch registration link metadata for the display device",
      tags: displayTags,
      responses: {
        200: {
          description: "Registration link metadata",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(registrationLinkMetadataResponseSchema),
              ),
            },
          },
        },
        404: {
          description: "Registration link not found or expired",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(async (c) => {
      const token = c.req.param("token");
      const parsed = tokenParamSchema.safeParse({ token });
      if (!parsed.success) {
        return c.json(
          {
            error: {
              code: "not_found",
              message: "Registration link not found",
              requestId: c.get("requestId"),
            },
          },
          404,
        );
      }

      const record = await deps.registrationLinkStore.peek(
        parsed.data.token,
        new Date(),
      );
      if (!record) {
        return c.json(
          {
            error: {
              code: "not_found",
              message: "Registration link not found or expired",
              requestId: c.get("requestId"),
            },
          },
          404,
        );
      }

      return c.json({
        data: {
          slug: record.slug,
          output: record.output,
          challengeNonce: record.challengeNonce,
          expiresAt: new Date(record.expiresAtMs).toISOString(),
        },
      });
    }),
  );

  // POST /registration-links/:token/claim — claim a registration link (unauthenticated)
  router.post(
    "/registration-links/:token/claim",
    setAction("displays.registration-link.claim", {
      route: "/displays/registration-links/:token/claim",
      resourceType: "display",
    }),
    validateJson(claimBodySchema),
    describeRoute({
      description:
        "Claim a registration link by providing cryptographic credentials",
      tags: displayTags,
      responses: {
        201: {
          description: "Display registered",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(claimResponseSchema)),
            },
          },
        },
        404: {
          description: "Registration link not found or expired",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        409: {
          description: "Display registration conflict",
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
        const token = c.req.param("token");
        const parsed = tokenParamSchema.safeParse({ token });
        if (!parsed.success) {
          return c.json(
            {
              error: {
                code: "not_found",
                message: "Registration link not found",
                requestId: c.get("requestId"),
              },
            },
            404,
          );
        }

        const payload = c.req.valid("json");
        const registered = await useCases.claimRegistrationLink.execute({
          token: parsed.data.token,
          fingerprint: payload.fingerprint,
          publicKey: payload.publicKey,
          keyAlgorithm: payload.keyAlgorithm,
          registrationSignature: payload.registrationSignature,
        });
        return c.json({ data: registered }, 201);
      },
      ...applicationErrorMappers,
    ),
  );
};
