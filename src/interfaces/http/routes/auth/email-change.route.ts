import { setCookie } from "hono/cookie";
import { describeRoute, resolver } from "hono-openapi";
import { InvalidCredentialsError } from "#/application/use-cases/auth";
import { DuplicateEmailError } from "#/application/use-cases/rbac/errors";
import { env } from "#/env";
import { resolveClientIp } from "#/interfaces/http/lib/request-client-ip";
import { requireJwtUser } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  conflict,
  errorResponseSchema,
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
  postAuthProfileEmailChangeRequestSchema,
  postAuthProfileEmailChangeVerifySchema,
} from "#/interfaces/http/validators/auth.schema";
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

export const registerAuthEmailChangeRoutes = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  useCases: AuthRouterUseCases;
  jwtMiddleware: AuthMiddleware;
}) => {
  const { router, deps, useCases, jwtMiddleware } = args;

  router.post(
    "/profile/email-change/request",
    setAction("auth.profile.email_change.request", {
      route: "/auth/profile/email-change/request",
      resourceType: "user",
    }),
    jwtMiddleware,
    requireJwtUser,
    validateJson(postAuthProfileEmailChangeRequestSchema),
    describeRoute({
      description:
        "Request email change verification link for current user account",
      tags: authTags,
      responses: {
        200: {
          description: "Verification requested; returns refreshed auth payload",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(authResponseSchema)),
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
        409: {
          description: "Email conflict",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        422: {
          description: "Validation error",
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
        c.set("resourceId", userId);
        const payload = c.req.valid("json");
        await useCases.requestEmailChange.execute({
          userId,
          email: payload.email,
        });
        const result = await useCases.refreshSession.execute({ userId });
        const body = await buildAuthResponse(deps, result);
        setCookie(c, deps.authSessionCookieName, body.token, {
          httpOnly: true,
          secure: c.req.url.startsWith("https://"),
          sameSite: "Lax",
          path: "/",
          expires: new Date(body.expiresAt),
        });
        return c.json(toApiResponse(body));
      },
      mapErrorToResponse(DuplicateEmailError, conflict),
      ...applicationErrorMappers,
      mapErrorToResponse(InvalidCredentialsError, unauthorized),
    ),
  );

  router.post(
    "/profile/email-change/verify",
    setAction("auth.profile.email_change.verify", {
      route: "/auth/profile/email-change/verify",
      resourceType: "user",
    }),
    validateJson(postAuthProfileEmailChangeVerifySchema),
    describeRoute({
      description: "Verify and apply pending email change with one-time token",
      tags: authTags,
      responses: {
        204: { description: "Email updated" },
        409: {
          description: "Email conflict",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        422: {
          description: "Invalid or expired token",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        429: {
          description: "Too many requests",
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
        const allowed = await deps.authSecurityStore.consumeEndpointAttempt({
          key: `verify-email-change|${ip}`,
          nowMs: Date.now(),
          windowSeconds: deps.authLoginRateLimitWindowSeconds,
          maxAttempts: 10,
        });
        if (!allowed) {
          return tooManyRequests(
            c,
            "Too many verification attempts. Try again.",
          );
        }

        const payload = c.req.valid("json");
        await useCases.verifyEmailChange.execute({ token: payload.token });
        return c.body(null, 204);
      },
      mapErrorToResponse(DuplicateEmailError, conflict),
      ...applicationErrorMappers,
    ),
  );
};
