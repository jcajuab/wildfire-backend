import { deleteCookie } from "hono/cookie";
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
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  type AuthMiddleware,
  type AuthRouter,
  type AuthRouterDeps,
  type AuthRouterUseCases,
  authResponseSchema,
  authTags,
  buildAuthResponse,
} from "./shared";

export const registerAuthSessionRoutes = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  useCases: AuthRouterUseCases;
  jwtMiddleware: AuthMiddleware;
}) => {
  const { router, deps, useCases, jwtMiddleware } = args;

  router.post(
    "/session/refresh",
    setAction("auth.session.refresh", {
      route: "/auth/session/refresh",
      resourceType: "session",
    }),
    jwtMiddleware,
    requireJwtUser,
    describeRoute({
      description: "Refresh current authenticated session JWT",
      tags: authTags,
      responses: {
        200: {
          description: "Authenticated user",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(authResponseSchema)),
            },
          },
        },
        401: { ...unauthorizedResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        c.set("resourceId", userId);
        const result = await useCases.refreshSession.execute({
          userId,
          currentSessionId: c.get("sessionId"),
        });
        const body = await buildAuthResponse(deps, result);
        setAuthSessionCookie(
          c,
          deps.authSessionCookieName,
          body.token,
          body.expiresAt,
        );
        return c.json(toApiResponse(body));
      },
      ...applicationErrorMappers,
      mapErrorToResponse(InvalidCredentialsError, unauthorized),
    ),
  );

  router.post(
    "/logout",
    setAction("auth.session.logout", {
      route: "/auth/logout",
      resourceType: "session",
    }),
    jwtMiddleware,
    requireJwtUser,
    describeRoute({
      description: "Logout current user (no-op)",
      tags: authTags,
      responses: {
        204: {
          description: "Logged out",
        },
        401: { ...unauthorizedResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        c.set("resourceId", c.get("userId"));
        const sessionId = c.get("sessionId");
        if (sessionId) {
          const isOwnedByUser = await deps.authSessionRepository.isOwnedByUser(
            sessionId,
            c.get("userId"),
            new Date(),
          );
          if (!isOwnedByUser) {
            return unauthorized(c, "Unauthorized");
          }
          await deps.authSessionRepository.revokeById(sessionId);
        }
        deleteCookie(c, deps.authSessionCookieName, { path: "/" });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/profile",
    setAction("auth.account.delete", {
      route: "/auth/profile",
      resourceType: "user",
    }),
    jwtMiddleware,
    requireJwtUser,
    describeRoute({
      description: "Delete current user account (self-deletion)",
      tags: authTags,
      responses: {
        204: {
          description: "Account deleted",
        },
        401: { ...unauthorizedResponse },
        404: { ...notFoundResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        c.set("resourceId", userId);
        await deps.authSessionRepository.revokeAllForUser(userId);
        deleteCookie(c, deps.authSessionCookieName, { path: "/" });
        await deps.deleteCurrentUserUseCase.execute({ userId });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
