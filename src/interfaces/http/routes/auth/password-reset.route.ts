import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  postAuthForgotPasswordSchema,
  postAuthResetPasswordSchema,
} from "#/interfaces/http/validators/auth.schema";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthRouter,
  type AuthRouterDeps,
  type AuthRouterUseCases,
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

export const registerAuthPasswordResetRoutes = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  useCases: AuthRouterUseCases;
}) => {
  const { router, deps, useCases } = args;

  router.post(
    "/forgot-password",
    setAction("auth.password.reset.request", {
      route: "/auth/forgot-password",
      resourceType: "user",
    }),
    validateJson(postAuthForgotPasswordSchema),
    describeRoute({
      description: "Request password reset token (always returns 204)",
      tags: authTags,
      responses: {
        204: { description: "Reset request accepted" },
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
          forwardedFor: c.req.header("x-forwarded-for"),
          realIp: c.req.header("x-real-ip"),
        });
        const allowed = deps.authSecurityStore.consumeEndpointAttempt({
          key: `forgot-password|${ip}`,
          nowMs: Date.now(),
          windowSeconds: deps.authLoginRateLimitWindowSeconds,
          maxAttempts: 5,
        });
        if (!allowed) {
          return c.json(
            {
              error: {
                code: "TOO_MANY_REQUESTS",
                message: "Too many password reset requests. Try again later.",
              },
            },
            429,
          );
        }

        const payload = c.req.valid("json");
        await useCases.forgotPassword.execute({ email: payload.email });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/reset-password",
    setAction("auth.password.reset.complete", {
      route: "/auth/reset-password",
      resourceType: "user",
    }),
    validateJson(postAuthResetPasswordSchema),
    describeRoute({
      description: "Reset password using one-time token",
      tags: authTags,
      responses: {
        204: { description: "Password reset complete" },
        400: {
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
          forwardedFor: c.req.header("x-forwarded-for"),
          realIp: c.req.header("x-real-ip"),
        });
        const allowed = deps.authSecurityStore.consumeEndpointAttempt({
          key: `reset-password|${ip}`,
          nowMs: Date.now(),
          windowSeconds: deps.authLoginRateLimitWindowSeconds,
          maxAttempts: 10,
        });
        if (!allowed) {
          return c.json(
            {
              error: {
                code: "TOO_MANY_REQUESTS",
                message: "Too many reset attempts. Try again later.",
              },
            },
            429,
          );
        }

        const payload = c.req.valid("json");
        await useCases.resetPassword.execute({
          token: payload.token,
          newPassword: payload.newPassword,
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
