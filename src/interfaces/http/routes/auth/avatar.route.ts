import { bodyLimit } from "hono/body-limit";
import { describeRoute, resolver } from "hono-openapi";
import { logger } from "#/infrastructure/observability/logger";
import { setAuthSessionCookie } from "#/interfaces/http/lib/auth-cookie";
import { requireJwtUser } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import { apiResponseSchema, toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  notFoundResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
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
              schema: resolver(apiResponseSchema(authResponseSchema)),
            },
          },
        },
        422: { ...validationErrorResponse },
        401: { ...unauthorizedResponse },
        404: { ...notFoundResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        c.set("resourceId", userId);
        const payload = c.req.valid("form");
        logger.info(
          {
            component: "auth",
            event: "avatar.upload.started",
            userId,
          },
          "avatar upload start",
        );

        const file = payload.file;
        const buffer = await file.arrayBuffer();

        await deps.setCurrentUserAvatarUseCase.execute({
          userId,
          body: new Uint8Array(buffer),
          contentType: file.type,
          contentLength: file.size,
        });

        logger.info(
          {
            component: "auth",
            event: "avatar.upload.completed",
            userId,
          },
          "avatar upload done",
        );

        const result = await useCases.refreshSession.execute({ userId });
        const body = await buildAuthResponse(deps, result);
        setAuthSessionCookie(
          c,
          deps.authSessionCookieName,
          body.token,
          body.expiresAt,
          deps.secureCookies,
        );
        return c.json(toApiResponse(body));
      },
      ...applicationErrorMappers,
    ),
  );
};
