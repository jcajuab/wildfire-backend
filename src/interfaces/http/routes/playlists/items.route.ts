import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  addPlaylistItemSchema,
  playlistIdParamSchema,
  playlistItemParamSchema,
  playlistItemSchema,
  reorderPlaylistItemsSchema,
  updatePlaylistItemSchema,
} from "#/interfaces/http/validators/playlists.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AuthorizePermission,
  type PlaylistsRouter,
  type PlaylistsRouterUseCases,
  playlistTags,
} from "./shared";

export const registerPlaylistItemRoutes = (args: {
  router: PlaylistsRouter;
  useCases: PlaylistsRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.post(
    "/:id/items",
    setAction("playlists.item.create", {
      route: "/playlists/:id/items",
      resourceType: "playlist-item",
    }),
    ...authorize("playlists:update"),
    validateParams(playlistIdParamSchema),
    validateJson(addPlaylistItemSchema),
    describeRoute({
      description: "Add playlist item",
      tags: playlistTags,
      responses: {
        201: {
          description: "Playlist item created",
          content: {
            "application/json": {
              schema: resolver(playlistItemSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        const result = await useCases.addPlaylistItem.execute({
          playlistId: params.id,
          contentId: payload.contentId,
          sequence: payload.sequence,
          duration: payload.duration,
        });
        c.set("resourceId", result.id);
        return c.json(result, 201);
      },
      ...applicationErrorMappers,
    ),
  );

  router.patch(
    "/:id/items/:itemId",
    setAction("playlists.item.update", {
      route: "/playlists/:id/items/:itemId",
      resourceType: "playlist-item",
    }),
    ...authorize("playlists:update"),
    validateParams(playlistItemParamSchema),
    validateJson(updatePlaylistItemSchema),
    describeRoute({
      description: "Update playlist item",
      tags: playlistTags,
      responses: {
        200: {
          description: "Playlist item updated",
          content: {
            "application/json": {
              schema: resolver(playlistItemSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.itemId);
        const payload = c.req.valid("json");
        const result = await useCases.updatePlaylistItem.execute({
          id: params.itemId,
          sequence: payload.sequence,
          duration: payload.duration,
        });
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );

  router.put(
    "/:id/items/reorder",
    setAction("playlists.item.reorder", {
      route: "/playlists/:id/items/reorder",
      resourceType: "playlist-item",
    }),
    ...authorize("playlists:update"),
    validateParams(playlistIdParamSchema),
    validateJson(reorderPlaylistItemsSchema),
    describeRoute({
      description: "Reorder playlist items atomically",
      tags: playlistTags,
      responses: {
        204: { description: "Reordered" },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        c.set("resourceId", params.id);
        await useCases.reorderPlaylistItems.execute({
          playlistId: params.id,
          orderedItemIds: payload.orderedItemIds,
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/:id/items/:itemId",
    setAction("playlists.item.delete", {
      route: "/playlists/:id/items/:itemId",
      resourceType: "playlist-item",
    }),
    ...authorize("playlists:update"),
    validateParams(playlistItemParamSchema),
    describeRoute({
      description: "Remove playlist item",
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
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.itemId);
        await useCases.deletePlaylistItem.execute({ id: params.itemId });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
