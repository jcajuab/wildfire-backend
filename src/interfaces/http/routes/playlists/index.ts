import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerPlaylistCrudRoutes } from "./crud.route";
import { registerPlaylistItemRoutes } from "./items.route";
import {
  type PlaylistsRouterDeps,
  type PlaylistsRouterUseCases,
} from "./shared";

export type { PlaylistsRouterDeps } from "./shared";

export interface PlaylistsRouterModule {
  deps: PlaylistsRouterDeps;
  useCases: PlaylistsRouterUseCases;
}

export const createPlaylistsRouter = ({
  deps,
  useCases,
}: PlaylistsRouterModule) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    checkPermissionUseCase: deps.checkPermissionUseCase,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
  });

  registerPlaylistCrudRoutes({ router, useCases, authorize });
  registerPlaylistItemRoutes({ router, useCases, authorize });

  return router;
};
