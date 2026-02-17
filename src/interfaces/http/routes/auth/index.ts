import { Hono } from "hono";
import { createJwtMiddleware } from "#/infrastructure/auth/jwt";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { registerAuthAvatarRoute } from "./avatar.route";
import { registerAuthLoginRoute } from "./login.route";
import { registerAuthPasswordRoute } from "./password.route";
import { registerAuthPasswordResetRoutes } from "./password-reset.route";
import { registerAuthProfileRoute } from "./profile.route";
import { registerAuthSessionRoutes } from "./session.route";
import { type AuthRouterDeps, createAuthUseCases } from "./shared";

export type { AuthRouterDeps } from "./shared";

export const createAuthRouter = (deps: AuthRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const useCases = createAuthUseCases(deps);
  const jwtMiddleware = createJwtMiddleware({
    secret: deps.jwtSecret,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
    allowBearerFallback: deps.authSessionDualMode,
  });

  registerAuthProfileRoute({ router, deps, useCases, jwtMiddleware });
  registerAuthLoginRoute({ router, deps, useCases });
  registerAuthSessionRoutes({ router, deps, useCases, jwtMiddleware });
  registerAuthPasswordRoute({ router, deps, jwtMiddleware });
  registerAuthPasswordResetRoutes({ router, deps, useCases });
  registerAuthAvatarRoute({ router, deps, useCases, jwtMiddleware });

  return router;
};
