import { describeRoute, resolver } from "hono-openapi";
import { InvalidCredentialsError } from "#/application/use-cases/auth";
import { NotFoundError } from "#/application/use-cases/rbac/errors";
import { requireJwtUser } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  errorResponseSchema,
  notFound,
  unauthorized,
} from "#/interfaces/http/responses";
import { patchAuthMeSchema } from "#/interfaces/http/validators/auth.schema";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthMiddleware,
  type AuthRouter,
  type AuthRouterDeps,
  type AuthRouterUseCases,
  authResponseSchema,
  authTags,
  buildAuthResponse,
} from "./shared";

export const registerAuthProfileRoute = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  useCases: AuthRouterUseCases;
  jwtMiddleware: AuthMiddleware;
}) => {
  const { router, deps, useCases, jwtMiddleware } = args;

  router.patch(
    "/me",
    setAction("auth.profile.update", {
      route: "/auth/me",
      resourceType: "user",
    }),
    jwtMiddleware,
    requireJwtUser,
    validateJson(patchAuthMeSchema),
    describeRoute({
      description: "Update current user profile (e.g. name)",
      tags: authTags,
      responses: {
        200: {
          description: "Profile updated; returns full auth payload",
          content: {
            "application/json": {
              schema: resolver(authResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
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
          description: "User not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const userId = c.get("userId");
      c.set("resourceId", userId);
      const payload = c.req.valid("json");
      try {
        await deps.updateCurrentUserProfileUseCase.execute({
          userId,
          name: payload.name,
          timezone: payload.timezone,
        });
        const result = await useCases.refreshSession.execute({ userId });
        const body = await buildAuthResponse(deps, result);
        return c.json(body);
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          return unauthorized(c, error.message);
        }
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );
};
