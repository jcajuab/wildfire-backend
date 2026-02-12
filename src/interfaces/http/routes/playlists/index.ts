import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerPlaylistCrudRoutes } from "./crud.route";
import { registerPlaylistItemRoutes } from "./items.route";
import { createPlaylistsUseCases, type PlaylistsRouterDeps } from "./shared";

export type { PlaylistsRouterDeps } from "./shared";

export const createPlaylistsRouter = (deps: PlaylistsRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    authorizationRepository: deps.repositories.authorizationRepository,
  });
  const useCases = createPlaylistsUseCases(deps);

  registerPlaylistCrudRoutes({ router, useCases, authorize });
  registerPlaylistItemRoutes({ router, useCases, authorize });

  return router;
};
