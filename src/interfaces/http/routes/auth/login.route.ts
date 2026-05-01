import { getCookie, setCookie } from "hono/cookie";
import { describeRoute, resolver } from "hono-openapi";
import { parseRefreshTokenValue } from "#/application/auth/refresh-token";
import { InvalidCredentialsError } from "#/application/use-cases/auth";
import { AUTH_SESSION_COOKIE_OPTIONS } from "#/interfaces/http/lib/constants";
import { resolveClientIp } from "#/interfaces/http/lib/request-client-ip";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  errorResponseSchema,
  tooManyRequests,
  unauthorized,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { tooManyRequestsResponse } from "#/interfaces/http/routes/shared/openapi-responses";
import { authLoginSchema } from "#/interfaces/http/validators/auth.schema";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthRouter,
  type AuthRouterDeps,
  type AuthRouterUseCases,
  authResponseSchema,
  authTags,
  buildAuthResponse,
} from "./shared";

export const registerAuthLoginRoute = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  useCases: AuthRouterUseCases;
}) => {
  const { router, deps, useCases } = args;

  router.post(
    "/login",
    setAction("auth.session.login", {
      route: "/auth/login",
      resourceType: "session",
    }),
    validateJson(authLoginSchema),
    describeRoute({
      description: "Authenticate user credentials and issue access token",
      tags: authTags,
      responses: {
        200: {
          description: "Authenticated",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(authResponseSchema)),
            },
          },
        },
        422: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        401: {
          description: "Invalid credentials",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        429: { ...tooManyRequestsResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const nowMs = Date.now();
        const username = payload.username.trim().toLowerCase();
        const ip = resolveClientIp({
          headers: {
            forwardedFor: c.req.header("x-forwarded-for"),
            realIp: c.req.header("x-real-ip"),
            cfConnectingIp: c.req.header("cf-connecting-ip"),
            xClientIp: c.req.header("x-client-ip"),
            forwarded: c.req.header("forwarded"),
          },
          trustProxyHeaders: deps.trustProxyHeaders,
        });
        const loginKey = `${username}|${ip}`;
        const allowed = await deps.authSecurityStore.checkLoginAllowed(
          loginKey,
          nowMs,
        );
        if (!allowed.allowed) {
          return tooManyRequests(
            c,
            "Too many failed login attempts. Try again later.",
          );
        }
        if (
          !(await deps.authSecurityStore.consumeEndpointAttempt({
            key: `login-username|${username}`,
            nowMs,
            windowSeconds: deps.authLoginRateLimitWindowSeconds,
            maxAttempts: 10,
          }))
        ) {
          return tooManyRequests(
            c,
            "Too many login attempts for this account. Try again later.",
          );
        }
        if (
          !(await deps.authSecurityStore.consumeEndpointAttempt({
            key: `login-window|${ip}`,
            nowMs,
            windowSeconds: deps.authLoginRateLimitWindowSeconds,
            maxAttempts: deps.authLoginRateLimitMaxAttempts,
          }))
        ) {
          return tooManyRequests(
            c,
            "Too many login requests. Try again later.",
          );
        }
        let result: Awaited<
          ReturnType<typeof useCases.authenticateUser.execute>
        >;
        try {
          result = await useCases.authenticateUser.execute(payload);
          await deps.authSecurityStore.clearLoginFailures(loginKey);
        } catch (error) {
          if (error instanceof InvalidCredentialsError) {
            await deps.authSecurityStore.registerLoginFailure({
              key: loginKey,
              nowMs,
              windowSeconds: deps.authLoginRateLimitWindowSeconds,
              lockoutThreshold: deps.authLoginLockoutThreshold,
              lockoutSeconds: deps.authLoginLockoutSeconds,
            });
          }
          throw error;
        }
        const staleRefreshCookie = getCookie(c, deps.authSessionCookieName);
        if (staleRefreshCookie) {
          const parsed = parseRefreshTokenValue(staleRefreshCookie);
          if (parsed) {
            await deps.authSessionRepository
              .revokeById(parsed.sessionId)
              .catch(() => {});
          }
        }
        const body = await buildAuthResponse(deps, result);
        setCookie(c, deps.authSessionCookieName, result.refreshToken ?? "", {
          ...AUTH_SESSION_COOKIE_OPTIONS,
          secure: deps.secureCookies,
          sameSite: deps.secureCookies ? "Strict" : "Lax",
          expires: new Date(
            result.refreshTokenExpiresAt ?? new Date(0).toISOString(),
          ),
        });
        c.set("resourceId", body.user.id);
        c.set("actorId", body.user.id);
        c.set("actorType", "user");
        return c.json({ data: body });
      },
      ...applicationErrorMappers,
      mapErrorToResponse(InvalidCredentialsError, unauthorized),
    ),
  );
};
