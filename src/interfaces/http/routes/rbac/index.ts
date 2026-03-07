import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerRbacPermissionRoutes } from "./permissions.route";
import { registerRbacRoleRoutes } from "./roles.route";
import { type RbacRouterDeps, type RbacRouterUseCases } from "./shared";
import { registerRbacUserRoutes } from "./users.route";

export type { RbacRouterDeps } from "./shared";

export interface RbacRouterModule {
  deps: RbacRouterDeps;
  useCases: RbacRouterUseCases;
}

export const createRbacRouter = ({ deps, useCases }: RbacRouterModule) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    checkPermissionUseCase: deps.checkPermissionUseCase,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
  });

  registerRbacRoleRoutes({ router, deps, useCases, authorize });
  registerRbacPermissionRoutes({ router, useCases, authorize });
  registerRbacUserRoutes({ router, useCases, deps, authorize });

  return router;
};
