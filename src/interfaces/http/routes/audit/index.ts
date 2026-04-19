import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerAuditExportRoute } from "./export.route";
import { registerAuditQueryRoutes } from "./query.route";
import { type AuditRouterDeps, type AuditRouterUseCases } from "./shared";

export type { AuditRouterDeps } from "./shared";

export interface AuditRouterModule {
  deps: AuditRouterDeps;
  useCases: AuditRouterUseCases;
}

export const createAuditRouter = ({ deps, useCases }: AuditRouterModule) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    checkPermissionUseCase: deps.checkPermissionUseCase,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
  });

  registerAuditQueryRoutes({ router, useCases, authorize });
  registerAuditExportRoute({
    router,
    useCases,
    authorize,
    repositories: {
      userRepository: deps.repositories.userRepository,
      displayRepository: deps.repositories.displayRepository,
    },
  });

  return router;
};
