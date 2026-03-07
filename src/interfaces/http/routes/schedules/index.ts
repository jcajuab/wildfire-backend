import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerScheduleCommandRoutes } from "./command.route";
import { registerScheduleQueryRoutes } from "./query.route";
import {
  type SchedulesRouterDeps,
  type SchedulesRouterUseCases,
} from "./shared";

export type { SchedulesRouterDeps } from "./shared";

export interface SchedulesRouterModule {
  deps: SchedulesRouterDeps;
  useCases: SchedulesRouterUseCases;
}

export const createSchedulesRouter = ({
  deps,
  useCases,
}: SchedulesRouterModule) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    checkPermissionUseCase: deps.checkPermissionUseCase,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
  });

  registerScheduleQueryRoutes({ router, useCases, authorize });
  registerScheduleCommandRoutes({ router, useCases, authorize });

  return router;
};
