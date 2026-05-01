import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { describeRoute, resolver } from "hono-openapi";
import {
  hashRefreshTokenSecret,
  parseRefreshTokenValue,
} from "#/application/auth/refresh-token";
import { InvalidCredentialsError } from "#/application/use-cases/auth";
import { logger } from "#/infrastructure/observability/logger";
import { AUTH_SESSION_COOKIE_OPTIONS } from "#/interfaces/http/lib/constants";
import { requireJwtUser } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
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

        const isServerRefresh = c.req.header("x-server-refresh") === "true";
        const result = await useCases.refreshSession.execute({
          refreshToken: refreshCookie,
          skipRotation: isServerRefresh,
        });
        const body = await buildAuthResponse(deps, result);
        if (
          result.refreshToken != null &&
          result.refreshTokenExpiresAt != null
        ) {
          setCookie(c, deps.authSessionCookieName, result.refreshToken, {
            ...AUTH_SESSION_COOKIE_OPTIONS,
            secure: deps.secureCookies,
            sameSite: deps.secureCookies ? "Strict" : "Lax",
            expires: new Date(result.refreshTokenExpiresAt),
          });
        }
        c.header("X-RateLimit-Limit", String(refreshStats.limit));
        c.header(
          "X-RateLimit-Remaining",
          String(Math.max(0, refreshStats.remaining)),
        );
        c.set("userId", body.user.id);
        logger.info(
          {
            event: "auth.refresh.completed",
            durationMs: Date.now() - startedAt,
            userId: body.user.id,
          },
          "Auth refresh completed",
        );
        return c.json({ data: body });
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
                c.set("userId", session.userId);
                await deps.authSessionRepository.revokeById(session.id);
              } else {
                c.set("userId", session.userId);
                await deps.authSessionRepository.revokeByFamilyId(
                  session.familyId,
                );
              }
            }
          }
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
