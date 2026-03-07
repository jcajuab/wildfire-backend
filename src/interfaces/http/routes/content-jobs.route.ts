import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerContentJobRoutes } from "#/interfaces/http/routes/content/jobs.route";
import {
  type ContentRouterDeps,
  type ContentRouterUseCases,
} from "#/interfaces/http/routes/content/shared";

export interface ContentJobsRouterModule {
  deps: ContentRouterDeps;
  useCases: ContentRouterUseCases;
}

export const createContentJobsRouter = ({
  deps,
  useCases,
}: ContentJobsRouterModule) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { jwtMiddleware, requirePermission } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    checkPermissionUseCase: deps.checkPermissionUseCase,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
  });

  router.use("/*", jwtMiddleware);
  registerContentJobRoutes({
    router,
    deps,
    useCases,
    requirePermission,
  });

  return router;
};
