import { describeRoute, resolver } from "hono-openapi";
import { NotFoundError } from "#/application/use-cases/playlists";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  badRequest,
  errorResponseSchema,
  notFound,
} from "#/interfaces/http/responses";
import {
  addPlaylistItemSchema,
  playlistIdParamSchema,
  playlistItemParamSchema,
  playlistItemSchema,
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
    async (c) => {
      const params = c.req.valid("param");
      const payload = addPlaylistItemSchema.parse(c.req.valid("json"));
      try {
        const result = await useCases.addPlaylistItem.execute({
          playlistId: params.id,
          contentId: payload.contentId,
          sequence: payload.sequence,
          duration: payload.duration,
        });
        c.set("resourceId", result.id);
        return c.json(result, 201);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        if (error instanceof Error) {
          return badRequest(c, error.message);
        }
        throw error;
      }
    },
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
    async (c) => {
      const params = c.req.valid("param");
      c.set("resourceId", params.itemId);
      const payload = updatePlaylistItemSchema.parse(c.req.valid("json"));
      try {
        const result = await useCases.updatePlaylistItem.execute({
          id: params.itemId,
          sequence: payload.sequence,
          duration: payload.duration,
        });
        return c.json(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        if (error instanceof Error) {
          return badRequest(c, error.message);
        }
        throw error;
      }
    },
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
    async (c) => {
      const params = c.req.valid("param");
      c.set("resourceId", params.itemId);
      try {
        await useCases.deletePlaylistItem.execute({ id: params.itemId });
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );
};
