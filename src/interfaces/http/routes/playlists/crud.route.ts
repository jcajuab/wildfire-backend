import { describeRoute, resolver } from "hono-openapi";
import { NotFoundError } from "#/application/use-cases/playlists";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema, notFound } from "#/interfaces/http/responses";
import {
  createPlaylistSchema,
  playlistIdParamSchema,
  playlistListResponseSchema,
  playlistSchema,
  playlistWithItemsSchema,
  updatePlaylistSchema,
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

export const registerPlaylistCrudRoutes = (args: {
  router: PlaylistsRouter;
  useCases: PlaylistsRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.get(
    "/",
    setAction("playlists.playlist.list", { route: "/playlists" }),
    ...authorize("playlists:read"),
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
    async (c) => {
      const items = await useCases.listPlaylists.execute();
      return c.json({ items });
    },
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
              schema: resolver(playlistSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const payload = c.req.valid("json");
      try {
        const result = await useCases.createPlaylist.execute({
          name: payload.name,
          description: payload.description ?? null,
          createdById: c.get("userId"),
        });
        c.set("resourceId", result.id);
        return c.json(result, 201);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
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
              schema: resolver(playlistWithItemsSchema),
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
    async (c) => {
      const params = c.req.valid("param");
      c.set("resourceId", params.id);
      try {
        const result = await useCases.getPlaylist.execute({ id: params.id });
        return c.json(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
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
              schema: resolver(playlistSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const params = c.req.valid("param");
      c.set("resourceId", params.id);
      const payload = c.req.valid("json");
      try {
        const result = await useCases.updatePlaylist.execute({
          id: params.id,
          name: payload.name,
          description: payload.description,
        });
        return c.json(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
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
      },
    }),
    async (c) => {
      const params = c.req.valid("param");
      c.set("resourceId", params.id);
      try {
        await useCases.deletePlaylist.execute({ id: params.id });
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
