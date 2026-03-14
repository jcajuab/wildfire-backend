import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { DISPLAY_REGISTRATION_CONSTRAINTS } from "#/application/use-cases/displays";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  errorResponseSchema,
  toApiResponse,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  authErrorResponses,
  authValidationErrorResponses,
} from "#/interfaces/http/routes/shared/openapi-responses";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import { displayTags } from "../contracts";
import {
  type AuthorizePermission,
  type DisplaysRouter,
  type DisplaysRouterUseCases,
} from "../module";

const registrationSessionBodySchema = z.object({
  registrationCode: z.string().regex(/^\d{6}$/),
});

const displayRegistrationBodySchema = z.object({
  registrationSessionId: z.string().uuid(),
  slug: z
    .string()
    .min(DISPLAY_REGISTRATION_CONSTRAINTS.minSlugLength)
    .max(DISPLAY_REGISTRATION_CONSTRAINTS.maxSlugLength)
    .regex(new RegExp(DISPLAY_REGISTRATION_CONSTRAINTS.slugPattern)),
  displayName: z.string().min(1).max(255),
  resolutionWidth: z.number().int().positive(),
  resolutionHeight: z.number().int().positive(),
  output: z.string().min(1).max(64),
  fingerprint: z.string().min(16).max(255),
  publicKey: z.string().min(1).max(4096),
  keyAlgorithm: z.literal("ed25519"),
  registrationSignature: z.string().min(1),
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

export const registerDisplayStaffRegistrationRoutes = (input: {
  router: DisplaysRouter;
  useCases: DisplaysRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = input;

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
        ...authErrorResponses,
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
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const session = await useCases.createDisplayRegistrationSession.execute(
          {
            registrationCode: payload.registrationCode,
          },
        );

        c.header(
          "Location",
          `${c.req.path}/${encodeURIComponent(session.registrationSessionId)}`,
        );
        return c.json(
          toApiResponse({
            ...session,
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
        const registered = await useCases.registerDisplay.execute(payload);
        c.header(
          "Location",
          `/api/v1/displays/${encodeURIComponent(registered.displayId)}`,
        );
        return c.json(toApiResponse(registered), 201);
      },
      ...applicationErrorMappers,
    ),
  );
};
