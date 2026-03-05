import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerContentJobRoutes } from "#/interfaces/http/routes/content/jobs.route";
import {
  type ContentRouterDeps,
  createContentUseCases,
} from "#/interfaces/http/routes/content/shared";

export const createContentJobsRouter = (deps: ContentRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { jwtMiddleware, requirePermission } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    authorizationRepository: deps.repositories.authorizationRepository,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
  });
  const useCases = createContentUseCases(deps);

  router.use("/*", jwtMiddleware);
  registerContentJobRoutes({
    router,
    useCases,
    requirePermission,
  });

  return router;
};
