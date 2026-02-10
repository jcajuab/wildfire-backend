import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { type ContentRepository } from "#/application/ports/content";
import { type PlaylistRepository } from "#/application/ports/playlists";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  AddPlaylistItemUseCase,
  CreatePlaylistUseCase,
  DeletePlaylistItemUseCase,
  DeletePlaylistUseCase,
  GetPlaylistUseCase,
  ListPlaylistsUseCase,
  NotFoundError,
  UpdatePlaylistItemUseCase,
  UpdatePlaylistUseCase,
} from "#/application/use-cases/playlists";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import {
  badRequest,
  errorResponseSchema,
  notFound,
} from "#/interfaces/http/responses";
import {
  addPlaylistItemSchema,
  createPlaylistSchema,
  playlistIdParamSchema,
  playlistItemParamSchema,
  playlistItemSchema,
  playlistListResponseSchema,
  playlistSchema,
  playlistWithItemsSchema,
  updatePlaylistItemSchema,
  updatePlaylistSchema,
} from "#/interfaces/http/validators/playlists.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";

export interface PlaylistsRouterDeps {
  jwtSecret: string;
  repositories: {
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    userRepository: UserRepository;
    authorizationRepository: AuthorizationRepository;
  };
}

export const createPlaylistsRouter = (deps: PlaylistsRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const playlistTags = ["Playlists"];
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    authorizationRepository: deps.repositories.authorizationRepository,
  });

  const listPlaylists = new ListPlaylistsUseCase({
    playlistRepository: deps.repositories.playlistRepository,
    userRepository: deps.repositories.userRepository,
  });
  const createPlaylist = new CreatePlaylistUseCase({
    playlistRepository: deps.repositories.playlistRepository,
    userRepository: deps.repositories.userRepository,
  });
  const getPlaylist = new GetPlaylistUseCase({
    playlistRepository: deps.repositories.playlistRepository,
    contentRepository: deps.repositories.contentRepository,
    userRepository: deps.repositories.userRepository,
  });
  const updatePlaylist = new UpdatePlaylistUseCase({
    playlistRepository: deps.repositories.playlistRepository,
    userRepository: deps.repositories.userRepository,
  });
  const deletePlaylist = new DeletePlaylistUseCase({
    playlistRepository: deps.repositories.playlistRepository,
  });
  const addPlaylistItem = new AddPlaylistItemUseCase({
    playlistRepository: deps.repositories.playlistRepository,
    contentRepository: deps.repositories.contentRepository,
  });
  const updatePlaylistItem = new UpdatePlaylistItemUseCase({
    playlistRepository: deps.repositories.playlistRepository,
    contentRepository: deps.repositories.contentRepository,
  });
  const deletePlaylistItem = new DeletePlaylistItemUseCase({
    playlistRepository: deps.repositories.playlistRepository,
  });

  router.get(
    "/",
    setAction("playlists.list", { route: "/playlists" }),
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
      const items = await listPlaylists.execute();
      return c.json({ items });
    },
  );

  router.post(
    "/",
    setAction("playlists.create", {
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
      const payload = createPlaylistSchema.parse(c.req.valid("json"));
      try {
        const result = await createPlaylist.execute({
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
    setAction("playlists.get", {
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
        const result = await getPlaylist.execute({ id: params.id });
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
    setAction("playlists.update", {
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
      const payload = updatePlaylistSchema.parse(c.req.valid("json"));
      try {
        const result = await updatePlaylist.execute({
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
    setAction("playlists.delete", {
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
        await deletePlaylist.execute({ id: params.id });
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.post(
    "/:id/items",
    setAction("playlists.item.add", {
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
        const result = await addPlaylistItem.execute({
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
        const result = await updatePlaylistItem.execute({
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
        await deletePlaylistItem.execute({ id: params.itemId });
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  return router;
};
