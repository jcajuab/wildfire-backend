import { describeRoute } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
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

  router.post(
    "/users/:id/ban",
    setAction("rbac.user.ban", {
      route: "/users/:id/ban",
      resourceType: "user",
    }),
    ...authorize("users:update"),
    validateParams(userIdParamSchema),
    describeRoute({
      description: "Ban a user",
      tags: userTags,
      responses: {
        200: { description: "User banned" },
        401: { ...unauthorizedResponse },
        403: { ...forbiddenResponse },
        404: { ...notFoundResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        await useCases.banUser.execute({
          id: params.id,
          callerUserId: c.get("userId"),
        });
        return c.json(toApiResponse({ success: true }));
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/users/:id/unban",
    setAction("rbac.user.unban", {
      route: "/users/:id/unban",
      resourceType: "user",
    }),
    ...authorize("users:update"),
    validateParams(userIdParamSchema),
    describeRoute({
      description: "Unban a user",
      tags: userTags,
      responses: {
        200: { description: "User unbanned" },
        401: { ...unauthorizedResponse },
        403: { ...forbiddenResponse },
        404: { ...notFoundResponse },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        await useCases.unbanUser.execute({
          id: params.id,
          callerUserId: c.get("userId"),
        });
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
        401: { ...unauthorizedResponse },
        403: { ...forbiddenResponse },
        404: { ...notFoundResponse },
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
