import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { setAction } from "#/interfaces/http/middleware/observability";
import { apiResponseSchema, toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  authErrorResponses,
  authValidationErrorResponses,
  notFoundResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import { validateParams } from "#/interfaces/http/validators/standard-validator";
import { displayTags } from "../contracts";
import {
  type AuthorizePermission,
  type DisplaysRouter,
  type DisplaysRouterUseCases,
} from "../module";

const registrationAttemptParamSchema = z.object({
  attemptId: z.string().uuid(),
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

export const registerDisplayStaffRegistrationAttemptRoutes = (input: {
  router: DisplaysRouter;
  useCases: DisplaysRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = input;

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
        ...authErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const created = await useCases.issueDisplayRegistrationAttempt.execute({
          ownerId: c.get("userId"),
        });
        c.header(
          "Location",
          `${c.req.path}/${encodeURIComponent(created.attemptId)}`,
        );
        return c.json(toApiResponse(created), 201);
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
        404: { ...notFoundResponse },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const result = await useCases.rotateDisplayRegistrationAttempt.execute({
          attemptId: params.attemptId,
          ownerId: c.get("userId"),
        });
        return c.json(toApiResponse(result));
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
        204: { description: "Registration attempt closed" },
        404: { ...notFoundResponse },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        await useCases.closeDisplayRegistrationAttempt.execute({
          attemptId: params.attemptId,
          ownerId: c.get("userId"),
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
