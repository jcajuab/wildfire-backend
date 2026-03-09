import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerContentCrudRoutes } from "./crud.route";
import { registerContentFileRoutes } from "./file.route";
import { type ContentRouterDeps, type ContentRouterUseCases } from "./shared";

export type { ContentRouterDeps } from "./shared";

export interface ContentRouterModule {
  deps: ContentRouterDeps;
  useCases: ContentRouterUseCases;
}

export const createContentRouter = ({
  deps,
  useCases,
}: ContentRouterModule) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { jwtMiddleware, requirePermission } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    checkPermissionUseCase: deps.checkPermissionUseCase,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
  });

  router.use("/*", jwtMiddleware);

  registerContentCrudRoutes({
    router,
    useCases,
    requirePermission,
    maxUploadBytes: deps.maxUploadBytes,
    videoMaxUploadBytes: deps.videoMaxUploadBytes,
  });
  registerContentFileRoutes({
    router,
    useCases,
    requirePermission,
  });

  return router;
};
