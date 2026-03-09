import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { PlaylistInUseError } from "#/application/use-cases/playlists";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  conflict,
  errorResponseSchema,
  toApiListResponse,
  toApiResponse,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  createPlaylistSchema,
  estimatePlaylistDurationSchema,
  playlistDurationEstimateResponseSchema,
  playlistIdParamSchema,
  playlistListQuerySchema,
  playlistListResponseSchema,
  playlistOptionSchema,
  playlistOptionsQuerySchema,
  playlistSchema,
  playlistWithItemsSchema,
  updatePlaylistSchema,
} from "#/interfaces/http/validators/playlists.schema";
import {
  validateJson,
  validateParams,
  validateQuery,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type PlaylistsRouter,
  type PlaylistsRouterUseCases,
  playlistTags,
} from "./shared";

export const registerPlaylistCrudRoutes = (args: {
  router: PlaylistsRouter;
  useCases: PlaylistsRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.get(
    "/options",
    setAction("playlists.playlist.options", { route: "/playlists/options" }),
    ...authorize("playlists:read"),
    validateQuery(playlistOptionsQuerySchema),
    describeRoute({
      description: "List playlist options",
      tags: playlistTags,
      responses: {
        200: {
          description: "Playlist options",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(z.array(playlistOptionSchema)),
              ),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const query = c.req.valid("query");
        const result = await useCases.listPlaylistOptions.execute({
          ownerId: c.get("userId"),
          q: query.q,
          status: query.status,
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/",
    setAction("playlists.playlist.list", { route: "/playlists" }),
    ...authorize("playlists:read"),
    validateQuery(playlistListQuerySchema),
    describeRoute({
      description: "List playlists",
      tags: playlistTags,
      responses: {
        200: {
          description: "Playlists list",
          content: {
            "application/json": {
              schema: resolver(playlistListResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const query = c.req.valid("query");
        const result = await useCases.listPlaylists.execute({
          ownerId: c.get("userId"),
          page: query.page,
          pageSize: query.pageSize,
          status: query.status,
          search: query.search,
          sortBy: query.sortBy,
          sortDirection: query.sortDirection,
        });
        return c.json(
          toApiListResponse({
            items: result.items,
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            requestUrl: c.req.url,
          }),
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/duration-estimate",
    setAction("playlists.playlist.estimate-duration", {
      route: "/playlists/duration-estimate",
      resourceType: "playlist",
    }),
    ...authorize("playlists:read"),
    validateJson(estimatePlaylistDurationSchema),
    describeRoute({
      description: "Estimate playlist effective duration for a display",
      tags: playlistTags,
      responses: {
        200: {
          description: "Playlist duration estimate",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(playlistDurationEstimateResponseSchema),
              ),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const result = await useCases.estimatePlaylistDuration.execute({
          ownerId: c.get("userId"),
          ...payload,
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/",
    setAction("playlists.playlist.create", {
      route: "/playlists",
      resourceType: "playlist",
    }),
    ...authorize("playlists:create"),
    validateJson(createPlaylistSchema),
    describeRoute({
      description: "Create playlist",
      tags: playlistTags,
      responses: {
        201: {
          description: "Playlist created",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(playlistSchema)),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const result = await useCases.createPlaylist.execute({
          name: payload.name,
          description: payload.description ?? null,
          ownerId: c.get("userId"),
        });
        c.set("resourceId", result.id);
        c.header("Location", `${c.req.path}/${encodeURIComponent(result.id)}`);
        return c.json(toApiResponse(result), 201);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:id",
    setAction("playlists.playlist.get", {
      route: "/playlists/:id",
      resourceType: "playlist",
    }),
    ...authorize("playlists:read"),
    validateParams(playlistIdParamSchema),
    describeRoute({
      description: "Get playlist with items",
      tags: playlistTags,
      responses: {
        200: {
          description: "Playlist details",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(playlistWithItemsSchema)),
            },
          },
        },
        404: {
          description: "Not found",
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
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const result = await useCases.getPlaylist.execute({
          id: params.id,
          ownerId: c.get("userId"),
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  router.patch(
    "/:id",
    setAction("playlists.playlist.update", {
      route: "/playlists/:id",
      resourceType: "playlist",
    }),
    ...authorize("playlists:update"),
    validateParams(playlistIdParamSchema),
    validateJson(updatePlaylistSchema),
    describeRoute({
      description: "Update playlist",
      tags: playlistTags,
      responses: {
        200: {
          description: "Playlist updated",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(playlistSchema)),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const payload = c.req.valid("json");
        const result = await useCases.updatePlaylist.execute({
          id: params.id,
          ownerId: c.get("userId"),
          name: payload.name,
          description: payload.description,
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/:id",
    setAction("playlists.playlist.delete", {
      route: "/playlists/:id",
      resourceType: "playlist",
    }),
    ...authorize("playlists:delete"),
    validateParams(playlistIdParamSchema),
    describeRoute({
      description: "Delete playlist",
      tags: playlistTags,
      responses: {
        204: { description: "Deleted" },
        404: {
          description: "Not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        409: {
          description: "Playlist is in use by one or more displays",
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
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        await useCases.deletePlaylist.execute({
          id: params.id,
          ownerId: c.get("userId"),
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(PlaylistInUseError, conflict),
    ),
  );
};
