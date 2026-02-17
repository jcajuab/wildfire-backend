import { bodyLimit } from "hono/body-limit";
import { setCookie } from "hono/cookie";
import { describeRoute, resolver } from "hono-openapi";
import { logger } from "#/infrastructure/observability/logger";
import { requireJwtUser } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
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
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        c.set("resourceId", userId);
        const payload = c.req.valid("form");
        logger.info({ userId }, "avatar upload start");

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
        setCookie(c, deps.authSessionCookieName, body.token, {
          httpOnly: true,
          secure: c.req.url.startsWith("https://"),
          sameSite: "Lax",
          path: "/",
          expires: new Date(body.expiresAt),
        });
        return c.json(body);
      },
      ...applicationErrorMappers,
    ),
  );
};
