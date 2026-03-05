import { setCookie } from "hono/cookie";
import { describeRoute, resolver } from "hono-openapi";
import { InvalidCredentialsError } from "#/application/use-cases/auth";
import { env } from "#/env";
import { resolveClientIp } from "#/interfaces/http/lib/request-client-ip";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  errorResponseSchema,
  tooManyRequests,
  unauthorized,
} from "#/interfaces/http/responses";
import {
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
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
      description: "Authenticate user credentials and issue JWT",
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
          trustProxyHeaders: env.TRUST_PROXY_HEADERS,
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
        // Per-username rate limit: prevents brute-force even with IP rotation
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
        // Per-IP rate limit: secondary layer
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
        let body: Awaited<ReturnType<typeof buildAuthResponse>>;
        try {
          const result = await useCases.authenticateUser.execute(payload);
          body = await buildAuthResponse(deps, result);
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
        setCookie(c, deps.authSessionCookieName, body.token, {
          httpOnly: true,
          secure: c.req.url.startsWith("https://"),
          sameSite: "Lax",
          path: "/",
          expires: new Date(body.expiresAt),
        });
        c.set("resourceId", body.user.id);
        c.set("actorId", body.user.id);
        c.set("actorType", "user");
        return c.json(body);
      },
      mapErrorToResponse(InvalidCredentialsError, unauthorized),
    ),
  );
};
