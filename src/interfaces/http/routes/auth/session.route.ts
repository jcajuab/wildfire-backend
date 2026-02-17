import { deleteCookie, setCookie } from "hono/cookie";
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

  router.get(
    "/me",
    setAction("auth.session.refresh", {
      route: "/auth/me",
      resourceType: "session",
    }),
    jwtMiddleware,
    requireJwtUser,
    describeRoute({
      description: "Get current user and refresh JWT",
      tags: authTags,
      responses: {
        200: {
          description: "Authenticated user",
          content: {
            "application/json": {
              schema: resolver(authResponseSchema),
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
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    (c) => {
      c.set("resourceId", c.get("userId"));
      const sessionId = c.get("sessionId");
      if (sessionId) {
        void deps.authSessionRepository.revokeById(sessionId);
      }
      deleteCookie(c, deps.authSessionCookieName, { path: "/" });
      return c.body(null, 204);
    },
  );

  router.delete(
    "/me",
    setAction("auth.account.delete", {
      route: "/auth/me",
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
        await deps.authSessionRepository.revokeAllForUser(userId);
        deleteCookie(c, deps.authSessionCookieName, { path: "/" });
        await deps.deleteCurrentUserUseCase.execute({ userId });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
