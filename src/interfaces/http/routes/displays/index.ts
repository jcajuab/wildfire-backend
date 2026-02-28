import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { createDisplaysUseCases, type DisplaysRouterDeps } from "./shared";
import { registerDisplayStaffRoutes } from "./staff.route";

export type { DisplaysRouterDeps } from "./shared";

export const createDisplaysRouter = (deps: DisplaysRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    authorizationRepository: deps.repositories.authorizationRepository,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
    authSessionDualMode: deps.authSessionDualMode,
  });
  const useCases = createDisplaysUseCases(deps);
  registerDisplayStaffRoutes({
    router,
    useCases,
    authorize,
  });

  return router;
};
