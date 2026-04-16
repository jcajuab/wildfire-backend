import { describeRoute } from "hono-openapi";
import { ListInvitationsUseCase } from "#/application/use-cases/auth";
import { logger } from "#/infrastructure/observability/logger";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { authValidationErrorResponses } from "#/interfaces/http/routes/shared/openapi-responses";
import { userListQuerySchema } from "#/interfaces/http/validators/rbac.schema";
import { validateQuery } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  addRoleSummariesToUsers,
  type RbacRouter,
  type RbacRouterDeps,
  type RbacRouterUseCases,
  userTags,
} from "./shared";

const hasPermission = (
  c: { get: (name: string) => unknown },
  permission: string,
): boolean => {
  const payload = c.get("jwtPayload") as
    | { isAdmin?: boolean; permissions?: string[] }
    | undefined;
  return (
    payload?.isAdmin === true ||
    payload?.permissions?.includes(permission) === true
  );
};

export const registerRbacUserBootstrapRoute = (args: {
  router: RbacRouter;
  deps: RbacRouterDeps;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, deps, useCases, authorize } = args;
  const listInvitationsUseCase =
    deps.invitationRepository != null
      ? new ListInvitationsUseCase({
          invitationRepository: deps.invitationRepository,
        })
      : null;

  router.get(
    "/users/bootstrap",
    setAction("rbac.user.bootstrap", {
      route: "/users/bootstrap",
      resourceType: "user",
    }),
    ...authorize("users:read"),
    validateQuery(userListQuerySchema),
    describeRoute({
      description: "Get users page bootstrap data",
      tags: userTags,
      responses: {
        200: { description: "Users bootstrap" },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const startedAt = Date.now();
        const query = c.req.valid("query");
        const canReadRoles = hasPermission(c, "roles:read");
        const canCreateUsers = hasPermission(c, "users:create");

        const [usersResult, roleOptions, invitations] = await Promise.all([
          useCases.listUsers.execute({
            page: query.page,
            pageSize: query.pageSize,
            q: query.q,
            sortBy: query.sortBy,
            sortDirection: query.sortDirection,
          }),
          canReadRoles
            ? useCases.listRoleOptions.execute({ limit: 100 })
            : Promise.resolve([]),
          canCreateUsers && listInvitationsUseCase != null
            ? listInvitationsUseCase.execute({ page: 1, pageSize: 100 })
            : Promise.resolve({
                items: [],
                total: 0,
                page: 1,
                pageSize: 100,
              }),
        ]);

        const enrichedUsers = await addRoleSummariesToUsers(
          usersResult.items,
          deps,
        );

        logger.info(
          {
            event: "http.bootstrap.users.completed",
            durationMs: Date.now() - startedAt,
            userCount: enrichedUsers.length,
            invitationCount: invitations.items.length,
          },
          "Users bootstrap completed",
        );

        return c.json(
          toApiResponse({
            users: {
              items: enrichedUsers,
              total: usersResult.total,
              page: usersResult.page,
              pageSize: usersResult.pageSize,
            },
            roleOptions,
            invitations: invitations.items,
          }),
        );
      },
      ...applicationErrorMappers,
    ),
  );
};
