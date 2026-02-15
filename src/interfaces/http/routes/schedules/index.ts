import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerScheduleCommandRoutes } from "./command.route";
import { registerScheduleQueryRoutes } from "./query.route";
import { createSchedulesUseCases, type SchedulesRouterDeps } from "./shared";

export type { SchedulesRouterDeps } from "./shared";

export const createSchedulesRouter = (deps: SchedulesRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    authorizationRepository: deps.repositories.authorizationRepository,
  });
  const useCases = createSchedulesUseCases(deps);

  registerScheduleQueryRoutes({ router, useCases, authorize });
  registerScheduleCommandRoutes({ router, useCases, authorize });

  return router;
};
