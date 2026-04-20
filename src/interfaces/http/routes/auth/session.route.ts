import { deleteCookie, getCookie } from "hono/cookie";
import { describeRoute, resolver } from "hono-openapi";
import {
  hashRefreshTokenSecret,
  parseRefreshTokenValue,
} from "#/application/auth/refresh-token";
import { InvalidCredentialsError } from "#/application/use-cases/auth";
import { logger } from "#/infrastructure/observability/logger";
import { setAuthSessionCookie } from "#/interfaces/http/lib/auth-cookie";
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
} from "./shared";

export const registerAuthSessionRoutes = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  useCases: AuthRouterUseCases;
  jwtMiddleware: AuthMiddleware;
}) => {
  const { router, deps, useCases, jwtMiddleware } = args;

  router.post(
    "/refresh",
    setAction("auth.session.refresh", {
      route: "/auth/refresh",
      resourceType: "session",
    }),
    describeRoute({
      description: "Rotate refresh token and issue a fresh access token",
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
        const startedAt = Date.now();
        const refreshCookie = getCookie(c, deps.authSessionCookieName);
        if (!refreshCookie) {
          return unauthorized(c, "Unauthorized");
        }

        const parsedRefreshToken = parseRefreshTokenValue(refreshCookie);
        const refreshStats =
          await deps.authSecurityStore.consumeEndpointAttemptWithStats({
            key: `session-refresh|${parsedRefreshToken?.sessionId ?? "unknown"}`,
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
          refreshToken: refreshCookie,
        });
        const body = await buildAuthResponse(deps, result);
        if (
          result.refreshToken != null &&
          result.refreshTokenExpiresAt != null
        ) {
          setAuthSessionCookie(
            c,
            deps.authSessionCookieName,
            result.refreshToken,
            result.refreshTokenExpiresAt,
            deps.secureCookies,
          );
        }
        c.header("X-RateLimit-Limit", String(refreshStats.limit));
        c.header(
          "X-RateLimit-Remaining",
          String(Math.max(0, refreshStats.remaining)),
        );
        logger.info(
          {
            event: "auth.refresh.completed",
            durationMs: Date.now() - startedAt,
            userId: body.user.id,
          },
          "Auth refresh completed",
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
    describeRoute({
      description: "Logout current user",
      tags: authTags,
      responses: {
        204: {
          description: "Logged out",
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const refreshCookie = getCookie(c, deps.authSessionCookieName);
        if (refreshCookie) {
          const parsedRefreshToken = parseRefreshTokenValue(refreshCookie);
          if (parsedRefreshToken) {
            const session = await deps.authSessionRepository.findBySessionId(
              parsedRefreshToken.sessionId,
            );
            if (session) {
              const hashedSecret = hashRefreshTokenSecret(
                parsedRefreshToken.secret,
              );
              const now = new Date();
              const matchesCurrent = hashedSecret === session.currentJti;
              const matchesGracePrevious =
                hashedSecret === session.previousJti &&
                session.previousJtiExpiresAt != null &&
                now < session.previousJtiExpiresAt;

              if (matchesCurrent || matchesGracePrevious) {
                await deps.authSessionRepository.revokeById(session.id);
              } else {
                await deps.authSessionRepository.revokeByFamilyId(
                  session.familyId,
                );
              }
            }
          }
        }

        deleteCookie(c, deps.authSessionCookieName, { path: "/v1/auth" });
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
        deleteCookie(c, deps.authSessionCookieName, { path: "/v1/auth" });
        await deps.deleteCurrentUserUseCase.execute({ userId });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
