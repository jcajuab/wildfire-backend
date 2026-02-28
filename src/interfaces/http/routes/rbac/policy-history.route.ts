import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  forbiddenResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  policyHistoryListResponseSchema,
  policyHistoryQuerySchema,
} from "#/interfaces/http/validators/rbac.schema";
import { validateQuery } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  permissionTags,
  type RbacRouter,
  type RbacRouterUseCases,
} from "./shared";

export const registerRbacPolicyHistoryRoutes = (args: {
  router: RbacRouter;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.get(
    "/policy-history",
    setAction("rbac.policyHistory.list", {
      route: "/policy-history",
      resourceType: "policy-history",
    }),
    ...authorize("roles:read"),
    validateQuery(policyHistoryQuerySchema),
    describeRoute({
      description: "List RBAC policy change history",
      tags: permissionTags,
      responses: {
        200: {
          description: "Policy history",
          content: {
            "application/json": {
              schema: resolver(policyHistoryListResponseSchema),
            },
          },
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        422: {
          ...validationErrorResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const query = c.req.valid("query");
        const result = await useCases.listPolicyHistory.execute(query);
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );
};
