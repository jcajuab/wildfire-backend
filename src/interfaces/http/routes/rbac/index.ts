import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerRbacPermissionRoutes } from "./permissions.route";
import { registerRbacRoleRoutes } from "./roles.route";
import { createRbacUseCases, type RbacRouterDeps } from "./shared";
import { registerRbacUserRoutes } from "./users.route";

export type { RbacRouterDeps } from "./shared";

export const createRbacRouter = (deps: RbacRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    authorizationRepository: deps.repositories.authorizationRepository,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
    authSessionDualMode: deps.authSessionDualMode,
  });
  const useCases = createRbacUseCases(deps);

  registerRbacRoleRoutes({ router, useCases, authorize });
  registerRbacPermissionRoutes({ router, useCases, authorize });
  registerRbacUserRoutes({ router, useCases, deps, authorize });

  return router;
};
