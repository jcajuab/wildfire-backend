import { deleteCookie } from "hono/cookie";
import { describeRoute, resolver } from "hono-openapi";
import { InvalidCredentialsError } from "#/application/use-cases/auth";
import { requireJwtUser } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  errorResponseSchema,
  tooManyRequests,
  unauthorized,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { postAuthMePasswordSchema } from "#/interfaces/http/validators/auth.schema";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthMiddleware,
  type AuthRouter,
  type AuthRouterDeps,
  authTags,
} from "./shared";

const resolveClientIp = (headers: {
  forwardedFor?: string;
  realIp?: string;
}): string => {
  const forwarded = headers.forwardedFor?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers.realIp?.trim() || "unknown";
};

export const registerAuthPasswordRoute = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  jwtMiddleware: AuthMiddleware;
}) => {
  const { router, deps, jwtMiddleware } = args;

  router.post(
    "/password/change",
    setAction("auth.password.update", {
      route: "/auth/password/change",
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
        422: {
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
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        const allowed = deps.authSecurityStore.consumeEndpointAttempt({
          key: `password-change|${userId}|${resolveClientIp({
            forwardedFor: c.req.header("x-forwarded-for"),
            realIp: c.req.header("x-real-ip"),
          })}`,
          nowMs: Date.now(),
          windowSeconds: deps.authLoginRateLimitWindowSeconds,
          maxAttempts: deps.authLoginRateLimitMaxAttempts,
        });
        if (!allowed) {
          return tooManyRequests(
            c,
            "Too many password change attempts. Try again later.",
          );
        }
        c.set("resourceId", userId);
        const payload = c.req.valid("json");
        await deps.changeCurrentUserPasswordUseCase.execute({
          userId,
          currentPassword: payload.currentPassword,
          newPassword: payload.newPassword,
        });
        await deps.authSessionRepository.revokeAllForUser(userId);
        deleteCookie(c, deps.authSessionCookieName, { path: "/" });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(InvalidCredentialsError, unauthorized),
    ),
  );
};
