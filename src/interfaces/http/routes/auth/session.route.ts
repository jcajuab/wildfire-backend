import { deleteCookie } from "hono/cookie";
import { describeRoute, resolver } from "hono-openapi";
import { InvalidCredentialsError } from "#/application/use-cases/auth";
import {
  setAuthSessionCookie,
  setCsrfCookie,
} from "#/interfaces/http/lib/auth-cookie";
import { requireJwtUser } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  toApiResponse,
  tooManyRequests,
  unauthorized,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  notFoundResponse,
  unauthorizedResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  type AuthMiddleware,
  type AuthRouter,
  type AuthRouterDeps,
  type AuthRouterUseCases,
  authResponseSchema,
  authTags,
  buildAuthResponse,
  sessionResponseSchema,
} from "./shared";

export const registerAuthSessionRoutes = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  useCases: AuthRouterUseCases;
  jwtMiddleware: AuthMiddleware;
}) => {
  const { router, deps, useCases, jwtMiddleware } = args;

  router.get(
    "/session",
    setAction("auth.session.get", {
      route: "/auth/session",
      resourceType: "session",
    }),
    jwtMiddleware,
    requireJwtUser,
    describeRoute({
      description: "Get current session user and permissions",
      tags: authTags,
      responses: {
        200: {
          description: "Current session",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(sessionResponseSchema)),
            },
          },
        },
        401: { ...unauthorizedResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        c.set("resourceId", userId);

        const sessionGetStats =
          await deps.authSecurityStore.consumeEndpointAttemptWithStats({
            key: `session-get|${userId}`,
            nowMs: Date.now(),
            windowSeconds: deps.authSessionRateLimitWindowSeconds,
            maxAttempts: deps.authSessionRateLimitMaxAttempts,
          });
        c.set("rateLimitLimit", String(sessionGetStats.limit));
        c.set("rateLimitRemaining", String(sessionGetStats.remaining));
        c.set("rateLimitReset", String(sessionGetStats.resetEpochSeconds));
        c.set("rateLimitRetryAfter", String(sessionGetStats.retryAfterSeconds));
        if (!sessionGetStats.allowed) {
          return tooManyRequests(c, "Too many requests");
        }

        const user = await deps.userRepository.findById(userId);
        if (!user) {
          return unauthorized(c, "Unauthorized");
        }
        const fullResponse = await buildAuthResponse(deps, {
          type: "bearer",
          token: "",
          expiresAt: "",
          user,
        });
        const { token: _token, ...sessionBody } = fullResponse;
        c.header("Cache-Control", "no-store");
        c.header("X-RateLimit-Limit", String(sessionGetStats.limit));
        c.header(
          "X-RateLimit-Remaining",
          String(Math.max(0, sessionGetStats.remaining)),
        );
        return c.json(toApiResponse(sessionBody));
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/session/refresh",
    setAction("auth.session.refresh", {
      route: "/auth/session/refresh",
      resourceType: "session",
    }),
    jwtMiddleware,
    requireJwtUser,
    describeRoute({
      description: "Refresh current authenticated session JWT",
      tags: authTags,
      responses: {
        200: {
          description: "Authenticated user",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(authResponseSchema)),
            },
          },
        },
        401: { ...unauthorizedResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        c.set("resourceId", userId);

        const refreshStats =
          await deps.authSecurityStore.consumeEndpointAttemptWithStats({
            key: `session-refresh|${userId}`,
            nowMs: Date.now(),
            windowSeconds: deps.authSessionRateLimitWindowSeconds,
            maxAttempts: deps.authSessionRateLimitMaxAttempts,
          });
        c.set("rateLimitLimit", String(refreshStats.limit));
        c.set("rateLimitRemaining", String(refreshStats.remaining));
        c.set("rateLimitReset", String(refreshStats.resetEpochSeconds));
        c.set("rateLimitRetryAfter", String(refreshStats.retryAfterSeconds));
        if (!refreshStats.allowed) {
          return tooManyRequests(c, "Too many requests");
        }

        const result = await useCases.refreshSession.execute({
          userId,
          currentSessionId: c.get("sessionId"),
          currentJti: c.get("jti") as string | undefined,
        });
        const body = await buildAuthResponse(deps, result);
        setAuthSessionCookie(
          c,
          deps.authSessionCookieName,
          body.token,
          body.expiresAt,
          deps.secureCookies,
        );
        setCsrfCookie(c, deps.csrfCookieName, deps.secureCookies);
        c.header("X-RateLimit-Limit", String(refreshStats.limit));
        c.header(
          "X-RateLimit-Remaining",
          String(Math.max(0, refreshStats.remaining)),
        );
        return c.json(toApiResponse(body));
      },
      ...applicationErrorMappers,
      mapErrorToResponse(InvalidCredentialsError, unauthorized),
    ),
  );

  router.post(
    "/logout",
    setAction("auth.session.logout", {
      route: "/auth/logout",
      resourceType: "session",
    }),
    jwtMiddleware,
    requireJwtUser,
    describeRoute({
      description: "Logout current user (no-op)",
      tags: authTags,
      responses: {
        204: {
          description: "Logged out",
        },
        401: { ...unauthorizedResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        c.set("resourceId", c.get("userId"));
        const sessionId = c.get("sessionId");
        if (sessionId) {
          const isOwnedByUser = await deps.authSessionRepository.isOwnedByUser(
            sessionId,
            c.get("userId"),
            new Date(),
          );
          if (!isOwnedByUser) {
            return unauthorized(c, "Unauthorized");
          }
          await deps.authSessionRepository.revokeById(sessionId);
        }
        deleteCookie(c, deps.authSessionCookieName, { path: "/" });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/profile",
    setAction("auth.account.delete", {
      route: "/auth/profile",
      resourceType: "user",
    }),
    jwtMiddleware,
    requireJwtUser,
    describeRoute({
      description: "Delete current user account (self-deletion)",
      tags: authTags,
      responses: {
        204: {
          description: "Account deleted",
        },
        401: { ...unauthorizedResponse },
        404: { ...notFoundResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        c.set("resourceId", userId);
        await deps.authSessionRepository.revokeAllForUser(userId);
        deleteCookie(c, deps.authSessionCookieName, { path: "/" });
        await deps.deleteCurrentUserUseCase.execute({ userId });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
