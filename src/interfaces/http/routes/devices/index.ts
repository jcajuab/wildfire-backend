import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerDeviceApiRoutes } from "./device-api.route";
import {
  createDevicesUseCases,
  createRequireDeviceApiKey,
  type DevicesRouterDeps,
} from "./shared";
import { registerDeviceStaffRoutes } from "./staff.route";

export type { DevicesRouterDeps } from "./shared";

export const createDevicesRouter = (deps: DevicesRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    authorizationRepository: deps.repositories.authorizationRepository,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
    authSessionDualMode: deps.authSessionDualMode,
  });
  const useCases = createDevicesUseCases(deps);
  const requireDeviceApiKey = createRequireDeviceApiKey(deps.deviceApiKey);

  registerDeviceApiRoutes({
    router,
    useCases,
    requireDeviceApiKey,
  });
  registerDeviceStaffRoutes({
    router,
    useCases,
    authorize,
  });

  return router;
};
