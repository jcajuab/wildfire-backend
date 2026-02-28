import { setCookie } from "hono/cookie";
import { describeRoute, resolver } from "hono-openapi";
import { InvalidCredentialsError } from "#/application/use-cases/auth";
import { requireJwtUser } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema, unauthorized } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { patchAuthMeSchema } from "#/interfaces/http/validators/auth.schema";
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

export const registerAuthProfileRoute = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  useCases: AuthRouterUseCases;
  jwtMiddleware: AuthMiddleware;
}) => {
  const { router, deps, useCases, jwtMiddleware } = args;

  router.patch(
    "/profile",
    setAction("auth.profile.update", {
      route: "/auth/profile",
      resourceType: "user",
    }),
    jwtMiddleware,
    requireJwtUser,
    validateJson(patchAuthMeSchema),
    describeRoute({
      description: "Update current user profile (e.g. name)",
      tags: authTags,
      responses: {
        200: {
          description: "Profile updated; returns full auth payload",
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
        const payload = c.req.valid("json");
        await deps.updateCurrentUserProfileUseCase.execute({
          userId,
          name: payload.name,
          timezone: payload.timezone,
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
        return c.json(body);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(InvalidCredentialsError, unauthorized),
    ),
  );
};
