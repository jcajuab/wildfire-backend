import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerAuditExportRoute } from "./export.route";
import { registerAuditQueryRoutes } from "./query.route";
import { type AuditRouterDeps, createAuditUseCases } from "./shared";

export type { AuditRouterDeps } from "./shared";

export const createAuditRouter = (deps: AuditRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    authorizationRepository: deps.repositories.authorizationRepository,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
    authSessionDualMode: deps.authSessionDualMode,
  });
  const useCases = createAuditUseCases(deps);

  registerAuditQueryRoutes({ router, useCases, authorize });
  registerAuditExportRoute({
    router,
    useCases,
    authorize,
    repositories: {
      userRepository: deps.repositories.userRepository,
      deviceRepository: deps.repositories.deviceRepository,
    },
  });

  return router;
};
