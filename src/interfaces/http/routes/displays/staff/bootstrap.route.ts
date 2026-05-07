import { describeRoute } from "hono-openapi";
import { logger } from "#/infrastructure/observability/logger";
import { jsonWithServerCache } from "#/interfaces/http/cache/server-cache";
import { setAction } from "#/interfaces/http/middleware/observability";
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
        return jsonWithServerCache(
          c,
          {
            domains: ["displays", "schedules", "playlists", "content"],
            ttl: "reference",
            varyByOwner: true,
          },
          async () => {
            const startedAt = Date.now();
            const query = c.req.valid("query");

            const displayGroups = await useCases.listDisplayGroups.execute();
            const derivedGroupIds =
              query.groupNames && query.groupNames.length > 0
                ? displayGroups
                    .filter((group) => query.groupNames?.includes(group.name))
                    .map((group) => group.id)
                : query.groupIds;

            const [displays, displayOutputOptions, runtimeOverrides] =
              await Promise.all([
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

            return {
              data: {
                displays,
                displayGroups,
                displayOutputOptions,
                runtimeOverrides,
              },
            };
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );
};
