import { describeRoute } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  authValidationErrorResponses,
  notFoundResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  createRoleSchema,
  roleIdParamSchema,
  updateRoleSchema,
} from "#/interfaces/http/validators/rbac.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type RbacRouter,
  type RbacRouterUseCases,
  roleTags,
} from "./shared";

export const registerRbacRoleWriteRoutes = (args: {
  router: RbacRouter;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.post(
    "/roles",
    setAction("rbac.role.create", { route: "/roles", resourceType: "role" }),
    ...authorize("roles:create"),
    validateJson(createRoleSchema),
    describeRoute({
      description: "Create role",
      tags: roleTags,
      responses: {
        201: { description: "Role created" },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const role = await useCases.createRole.execute(payload);
        c.set("resourceId", role.id);
        c.header("Location", `${c.req.path}/${encodeURIComponent(role.id)}`);
        return c.json(toApiResponse(role), 201);
      },
      ...applicationErrorMappers,
    ),
  );

  router.patch(
    "/roles/:id",
    setAction("rbac.role.update", {
      route: "/roles/:id",
      resourceType: "role",
    }),
    ...authorize("roles:update"),
    validateParams(roleIdParamSchema),
    validateJson(updateRoleSchema),
    describeRoute({
      description: "Update role",
      tags: roleTags,
      responses: {
        200: { description: "Role" },
        404: { ...notFoundResponse },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const payload = c.req.valid("json");
        const role = await useCases.updateRole.execute({
          id: params.id,
          ...payload,
        });
        return c.json(toApiResponse(role));
      },
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/roles/:id",
    setAction("rbac.role.delete", {
      route: "/roles/:id",
      resourceType: "role",
    }),
    ...authorize("roles:delete"),
    validateParams(roleIdParamSchema),
    describeRoute({
      description: "Delete role",
      tags: roleTags,
      responses: {
        204: { description: "Deleted" },
        404: { ...notFoundResponse },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        await useCases.deleteRole.execute({
          id: params.id,
          callerUserId: c.get("userId"),
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
