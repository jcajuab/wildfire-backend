import { bodyLimit } from "hono/body-limit";
import { describeRoute, resolver } from "hono-openapi";
import { NotFoundError } from "#/application/use-cases/rbac/errors";
import { logger } from "#/infrastructure/observability/logger";
import { requireJwtUser } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  errorResponseSchema,
  internalServerError,
  notFound,
} from "#/interfaces/http/responses";
import { avatarUploadSchema } from "#/interfaces/http/validators/auth.schema";
import { validateForm } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthMiddleware,
  type AuthRouter,
  type AuthRouterDeps,
  type AuthRouterUseCases,
  AVATAR_MAX_BYTES,
  authResponseSchema,
  authTags,
  buildAuthResponse,
} from "./shared";

export const registerAuthAvatarRoute = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  useCases: AuthRouterUseCases;
  jwtMiddleware: AuthMiddleware;
}) => {
  const { router, deps, useCases, jwtMiddleware } = args;

  router.put(
    "/me/avatar",
    setAction("auth.avatar.update", {
      route: "/auth/me/avatar",
      resourceType: "user",
    }),
    jwtMiddleware,
    requireJwtUser,
    bodyLimit({ maxSize: AVATAR_MAX_BYTES }),
    validateForm(avatarUploadSchema),
    describeRoute({
      description: "Upload or replace current user avatar",
      tags: authTags,
      responses: {
        200: {
          description: "Avatar updated; returns full auth payload",
          content: {
            "application/json": {
              schema: resolver(authResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid request (e.g. not an image or too large)",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
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
    async (c) => {
      const userId = c.get("userId");
      c.set("resourceId", userId);
      const payload = c.req.valid("form");
      logger.info({ userId }, "avatar upload start");

      try {
        const file = payload.file;
        const buffer = await file.arrayBuffer();

        await deps.setCurrentUserAvatarUseCase.execute({
          userId,
          body: new Uint8Array(buffer),
          contentType: file.type,
          contentLength: file.size,
        });

        logger.info({ userId }, "avatar upload done");

        const result = await useCases.refreshSession.execute({ userId });
        const body = await buildAuthResponse(deps, result);
        return c.json(body);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }

        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(
          {
            err,
            userId,
            errorMessage: err.message,
            errorName: err.name,
          },
          "avatar upload failed",
        );

        const message =
          process.env.NODE_ENV === "development"
            ? `Failed to upload profile picture: ${err.message}`
            : "Failed to upload profile picture. Please try again.";

        return internalServerError(c, message);
      }
    },
  );
};
