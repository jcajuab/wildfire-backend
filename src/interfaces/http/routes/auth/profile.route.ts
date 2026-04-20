import { getCookie } from "hono/cookie";
import { describeRoute, resolver } from "hono-openapi";
import { InvalidCredentialsError } from "#/application/use-cases/auth";
import { requireJwtUser } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  notFound,
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
  authResponseSchema,
  authTags,
  buildAuthResponse,
} from "./shared";

export const registerAuthProfileRoute = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  jwtMiddleware: AuthMiddleware;
}) => {
  const { router, deps, jwtMiddleware } = args;

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

        // Rotation-policy: profile mutations MUST NOT rotate the refresh
        // token (see ADR in .omc/plans/wildfire-media-auth-fix.md). We still
        // require a valid session cookie to be present, and we reissue a fresh
        // short-lived access token reflecting the updated user state.
        const refreshToken = getCookie(c, deps.authSessionCookieName);
        if (!refreshToken) {
          return unauthorized(c, "Unauthorized");
        }

        const user = await deps.userRepository.findById(userId);
        if (!user) {
          return notFound(c, "User not found");
        }

        const isAdmin = await deps.authorizationRepository.isAdminUser(userId);
        const permissions = (
          await deps.authorizationRepository.findPermissionsForUser(userId)
        ).map((permission) => `${permission.resource}:${permission.action}`);

        const issuedAt = deps.clock.nowSeconds();
        const expiresAt = issuedAt + deps.tokenTtlSeconds;
        const accessToken = await deps.tokenIssuer.issueToken({
          subject: user.id,
          issuedAt,
          expiresAt,
          issuer: deps.issuer,
          username: user.username,
          email: user.email ?? undefined,
          name: user.name,
          timezone: user.timezone ?? null,
          isAdmin,
          isInvitedUser: user.invitedAt != null,
          permissions,
        });

        const body = await buildAuthResponse(deps, {
          type: "bearer",
          accessToken,
          accessTokenExpiresAt: new Date(expiresAt * 1000).toISOString(),
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            name: user.name,
            timezone: user.timezone ?? null,
            avatarKey: user.avatarKey ?? null,
            invitedAt: user.invitedAt ?? null,
            isAdmin,
            isInvitedUser: user.invitedAt != null,
          },
          permissions,
        });

        return c.json(toApiResponse(body));
      },
      ...applicationErrorMappers,
      mapErrorToResponse(InvalidCredentialsError, unauthorized),
    ),
  );
};
