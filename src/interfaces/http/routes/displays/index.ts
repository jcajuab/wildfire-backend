import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { type DisplaysRouterDeps, type DisplaysRouterUseCases } from "./module";
import { registerDisplayStaffRoutes } from "./staff";

export type { DisplaysRouterDeps } from "./module";

export interface DisplaysRouterModule {
  deps: DisplaysRouterDeps;
  useCases: DisplaysRouterUseCases;
}

export const createDisplaysRouter = ({
  deps,
  useCases,
}: DisplaysRouterModule) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    checkPermissionUseCase: deps.checkPermissionUseCase,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
  });
  registerDisplayStaffRoutes({
    router,
    useCases,
    authorize,
    deps,
  });

  return router;
};
