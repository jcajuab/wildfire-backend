import { describeRoute } from "hono-openapi";
import { ListDisplayOptionsUseCase } from "#/application/use-cases/displays";
import { ListUserOptionsUseCase } from "#/application/use-cases/rbac";
import { logger } from "#/infrastructure/observability/logger";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { authValidationErrorResponses } from "#/interfaces/http/routes/shared/openapi-responses";
import { auditLogListQuerySchema } from "#/interfaces/http/validators/audit.schema";
import { validateQuery } from "#/interfaces/http/validators/standard-validator";
import {
  type AuditRouter,
  type AuditRouterDeps,
  type AuditRouterUseCases,
  type AuthorizePermission,
  auditTags,
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

export const registerAuditBootstrapRoute = (args: {
  router: AuditRouter;
  deps: AuditRouterDeps;
  useCases: AuditRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, deps, useCases, authorize } = args;
  const listUserOptionsUseCase = new ListUserOptionsUseCase({
    userRepository: deps.repositories.userRepository,
  });
  const listDisplayOptionsUseCase = new ListDisplayOptionsUseCase({
    displayRepository: deps.repositories.displayRepository,
  });

  router.get(
    "/events/bootstrap",
    setAction("audit.event.bootstrap", {
      route: "/audit/events/bootstrap",
      resourceType: "audit-log",
    }),
    ...authorize("audit:read"),
    validateQuery(auditLogListQuerySchema),
    describeRoute({
      description: "Get audit page bootstrap data",
      tags: auditTags,
      responses: {
        200: { description: "Audit bootstrap payload" },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const startedAt = Date.now();
        const query = c.req.valid("query");
        const canReadUsers = hasPermission(c, "users:read");
        const canReadDisplays = hasPermission(c, "displays:read");

        const [events, users, displays] = await Promise.all([
          useCases.listAuditLogs.execute(query),
          canReadUsers
            ? listUserOptionsUseCase.execute({ limit: 100 })
            : Promise.resolve([]),
          canReadDisplays
            ? listDisplayOptionsUseCase.execute({ limit: 100 })
            : Promise.resolve([]),
        ]);

        logger.info(
          {
            event: "http.bootstrap.audit.completed",
            durationMs: Date.now() - startedAt,
            eventCount: events.items.length,
          },
          "Audit bootstrap completed",
        );

        return c.json(
          toApiResponse({
            events,
            users,
            displays,
          }),
        );
      },
      ...applicationErrorMappers,
    ),
  );
};
