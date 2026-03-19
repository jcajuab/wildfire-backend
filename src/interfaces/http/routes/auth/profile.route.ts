import { describeRoute, resolver } from "hono-openapi";
import { InvalidCredentialsError } from "#/application/use-cases/auth";
import { setAuthSessionCookie } from "#/interfaces/http/lib/auth-cookie";
import { requireJwtUser } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  toApiResponse,
  unauthorized,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  notFoundResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
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
        const payload = c.req.valid("json");
        await deps.updateCurrentUserProfileUseCase.execute({
          userId,
          name: payload.name,
          timezone: payload.timezone,
          username: payload.username,
          email: payload.email,
        });
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
      mapErrorToResponse(InvalidCredentialsError, unauthorized),
    ),
  );
};
