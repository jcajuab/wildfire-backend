import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema } from "#/interfaces/http/responses";
import {
  postAuthForgotPasswordSchema,
  postAuthResetPasswordSchema,
} from "#/interfaces/http/validators/auth.schema";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import { type AuthRouter, type AuthRouterDeps, authTags } from "./shared";

interface PasswordResetRequest {
  readonly email: string;
  readonly expiresAtMs: number;
}

const passwordResetRequests = new Map<string, PasswordResetRequest>();
const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;

export const registerAuthPasswordResetRoutes = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
}) => {
  const { router, deps } = args;

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
      },
    }),
    async (c) => {
      const payload = c.req.valid("json");
      const user = await deps.userRepository.findByEmail(payload.email);
      if (user) {
        const token = crypto.randomUUID();
        passwordResetRequests.set(token, {
          email: payload.email,
          expiresAtMs: Date.now() + PASSWORD_RESET_TTL_MS,
        });
      }
      return c.body(null, 204);
    },
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
      },
    }),
    async (c) => {
      const payload = c.req.valid("json");
      const reset = passwordResetRequests.get(payload.token);
      if (!reset || reset.expiresAtMs <= Date.now()) {
        return c.json(
          {
            error: {
              code: "INVALID_TOKEN",
              message: "Reset token is invalid or expired.",
            },
          },
          400,
        );
      }

      const passwordHash = await deps.passwordHasher.hash(payload.newPassword);
      await deps.credentialsRepository.updatePasswordHash(
        reset.email,
        passwordHash,
      );
      const user = await deps.userRepository.findByEmail(reset.email);
      if (user) {
        await deps.authSessionRepository.revokeAllForUser(user.id);
      }
      passwordResetRequests.delete(payload.token);
      return c.body(null, 204);
    },
  );
};
