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
import { postAuthMePasswordSchema } from "#/interfaces/http/validators/auth.schema";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthMiddleware,
  type AuthRouter,
  type AuthRouterDeps,
  authTags,
} from "./shared";

export const registerAuthPasswordRoute = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  jwtMiddleware: AuthMiddleware;
}) => {
  const { router, deps, jwtMiddleware } = args;

  router.post(
    "/me/password",
    setAction("auth.password.update", {
      route: "/auth/me/password",
      resourceType: "user",
    }),
    jwtMiddleware,
    requireJwtUser,
    validateJson(postAuthMePasswordSchema),
    describeRoute({
      description: "Change current user password",
      tags: authTags,
      responses: {
        204: {
          description: "Password updated",
        },
        400: {
          description: "Invalid request (e.g. new password too short)",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        401: {
          description: "Unauthorized or current password incorrect",
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
        await deps.changeCurrentUserPasswordUseCase.execute({
          userId,
          currentPassword: payload.currentPassword,
          newPassword: payload.newPassword,
        });
        return c.body(null, 204);
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
