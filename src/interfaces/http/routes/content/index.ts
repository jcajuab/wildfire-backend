import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerContentCrudRoutes } from "./crud.route";
import { registerContentFileRoutes } from "./file.route";
import { type ContentRouterDeps, createContentUseCases } from "./shared";

export type { ContentRouterDeps } from "./shared";

export const createContentRouter = (deps: ContentRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { jwtMiddleware, requirePermission } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    authorizationRepository: deps.repositories.authorizationRepository,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
    authSessionDualMode: deps.authSessionDualMode,
  });
  const useCases = createContentUseCases(deps);

  router.use("/*", jwtMiddleware);

  registerContentCrudRoutes({
    router,
    useCases,
    requirePermission,
    maxUploadBytes: deps.maxUploadBytes,
  });
  registerContentFileRoutes({
    router,
    useCases,
    requirePermission,
  });

  return router;
};
