import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerSettingsCrudRoutes } from "./crud.route";
import {
  createSettingsUseCases,
  type SettingsRouterDeps,
  type SettingsRouterUseCases,
} from "./shared";

export type { SettingsRouterDeps } from "./shared";

export const createSettingsRouter = (deps: SettingsRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    authorizationRepository: deps.repositories.authorizationRepository,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
    authSessionDualMode: deps.authSessionDualMode,
  });
  const useCases: SettingsRouterUseCases = createSettingsUseCases(deps);

  registerSettingsCrudRoutes({
    router,
    useCases,
    authorize,
    listDisplayIds: async () =>
      (await deps.repositories.displayRepository.list()).map(
        (display) => display.id,
      ),
  });

  return router;
};
