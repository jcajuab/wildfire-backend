import { setCookie } from "hono/cookie";
import { describeRoute, resolver } from "hono-openapi";
import { InvalidCredentialsError } from "#/application/use-cases/auth";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
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

const resolveClientIp = (headers: {
  forwardedFor?: string;
  realIp?: string;
}): string => {
  const forwarded = headers.forwardedFor?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers.realIp?.trim() || "unknown";
};

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
              schema: resolver(authResponseSchema),
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
        const emailLower = payload.email.toLowerCase();
        const ip = resolveClientIp({
          forwardedFor: c.req.header("x-forwarded-for"),
          realIp: c.req.header("x-real-ip"),
        });
        const loginKey = `${emailLower}|${ip}`;
        const allowed = deps.authSecurityStore.checkLoginAllowed(
          loginKey,
          nowMs,
        );
        if (!allowed.allowed) {
          return tooManyRequests(
            c,
            "Too many failed login attempts. Try again later.",
          );
        }
        // Per-email-only rate limit: prevents brute-force even with IP rotation
        if (
          !deps.authSecurityStore.consumeEndpointAttempt({
            key: `login-email|${emailLower}`,
            nowMs,
            windowSeconds: deps.authLoginRateLimitWindowSeconds,
            maxAttempts: 10,
          })
        ) {
          return tooManyRequests(
            c,
            "Too many login attempts for this account. Try again later.",
          );
        }
        // Per-IP rate limit: secondary layer
        if (
          !deps.authSecurityStore.consumeEndpointAttempt({
            key: `login-window|${ip}`,
            nowMs,
            windowSeconds: deps.authLoginRateLimitWindowSeconds,
            maxAttempts: deps.authLoginRateLimitMaxAttempts,
          })
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
          deps.authSecurityStore.clearLoginFailures(loginKey);
        } catch (error) {
          if (error instanceof InvalidCredentialsError) {
            deps.authSecurityStore.registerLoginFailure({
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
