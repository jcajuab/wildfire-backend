import { describeRoute } from "hono-openapi";
import { logger } from "#/infrastructure/observability/logger";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { authErrorResponses } from "#/interfaces/http/routes/shared/openapi-responses";
import { displayListQuerySchema } from "#/interfaces/http/validators/displays.schema";
import { validateQuery } from "#/interfaces/http/validators/standard-validator";
import { displayTags } from "../contracts";
import {
  type AuthorizePermission,
  type DisplaysRouter,
  type DisplaysRouterDeps,
  type DisplaysRouterUseCases,
} from "../module";

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

export const registerDisplayStaffBootstrapRoute = (input: {
  router: DisplaysRouter;
  deps: DisplaysRouterDeps;
  useCases: DisplaysRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = input;

  router.get(
    "/bootstrap",
    setAction("displays.display.bootstrap", { route: "/displays/bootstrap" }),
    ...authorize("displays:read"),
    validateQuery(displayListQuerySchema),
    describeRoute({
      description: "Get displays page bootstrap data",
      tags: displayTags,
      responses: {
        200: { description: "Displays bootstrap payload" },
        ...authErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const startedAt = Date.now();
        const query = c.req.valid("query");
        const canLoadEmergencyContentOptions =
          hasPermission(c, "displays:update") ||
          hasPermission(c, "content:read");

        const displayGroups = await useCases.listDisplayGroups.execute();
        const derivedGroupIds =
          query.groupNames && query.groupNames.length > 0
            ? displayGroups
                .filter((group) => query.groupNames?.includes(group.name))
                .map((group) => group.id)
            : query.groupIds;

        const [
          displays,
          displayOutputOptions,
          runtimeOverrides,
          emergencyContentOptions,
        ] = await Promise.all([
          useCases.listDisplays.execute({
            page: query.page,
            pageSize: query.pageSize,
            q: query.q,
            status: query.status,
            output: query.output,
            groupIds: derivedGroupIds,
            sortBy: query.sortBy,
            sortDirection: query.sortDirection,
          }),
          useCases.listDisplayOutputOptions.execute(),
          useCases.getRuntimeOverrides.execute({ now: new Date() }),
          canLoadEmergencyContentOptions
            ? useCases.listEmergencyContentOptions.execute({
                ownerId: c.get("userId"),
                status: "READY",
              })
            : Promise.resolve([]),
        ]);

        logger.info(
          {
            event: "http.bootstrap.displays.completed",
            durationMs: Date.now() - startedAt,
            resultCount: displays.items.length,
            groupCount: displayGroups.length,
          },
          "Displays bootstrap completed",
        );

        return c.json(
          toApiResponse({
            displays,
            displayGroups,
            displayOutputOptions,
            runtimeOverrides,
            emergencyContentOptions,
          }),
        );
      },
      ...applicationErrorMappers,
    ),
  );
};
