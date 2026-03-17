import { describeRoute } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  authErrorResponses,
  notFoundResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import { userIdParamSchema } from "#/interfaces/http/validators/rbac.schema";
import { validateParams } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type RbacRouter,
  type RbacRouterDeps,
  type RbacRouterUseCases,
  userTags,
} from "./shared";

export const registerRbacUserActionRoutes = (args: {
  router: RbacRouter;
  deps: RbacRouterDeps;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.put(
    "/users/:id/status",
    setAction("rbac.user.status", {
      route: "/users/:id/status",
      resourceType: "user",
    }),
    ...authorize("users:update"),
    validateParams(userIdParamSchema),
    describeRoute({
      description: "Update user status (ban or unban)",
      tags: userTags,
      responses: {
        200: { description: "User status updated" },
        404: { ...notFoundResponse },
        ...authErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const body = await c.req.json<{ banned: boolean }>();
        if (body.banned) {
          await useCases.banUser.execute({
            id: params.id,
            callerUserId: c.get("userId"),
          });
        } else {
          await useCases.unbanUser.execute({
            id: params.id,
            callerUserId: c.get("userId"),
          });
        }
        return c.json(toApiResponse({ success: true }));
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/users/:id/reset-password",
    setAction("rbac.user.reset-password", {
      route: "/users/:id/reset-password",
      resourceType: "user",
    }),
    ...authorize("users:update"),
    validateParams(userIdParamSchema),
    describeRoute({
      description: "Admin reset password for an invited user",
      tags: userTags,
      responses: {
        200: { description: "Password reset; returns plaintext password" },
        404: { ...notFoundResponse },
        ...authErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const result = await useCases.adminResetPassword.execute({
          id: params.id,
          callerUserId: c.get("userId"),
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );
};
