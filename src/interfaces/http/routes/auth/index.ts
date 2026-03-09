import { Hono } from "hono";
import { createJwtMiddleware } from "#/interfaces/http/middleware/jwt-auth";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { registerAuthAvatarRoute } from "./avatar.route";
import { registerAuthEmailChangeRoutes } from "./email-change.route";
import { registerAuthInvitationRoutes } from "./invitation.route";
import { registerAuthLoginRoute } from "./login.route";
import { registerAuthPasswordRoute } from "./password.route";
import { registerAuthPasswordResetRoutes } from "./password-reset.route";
import { registerAuthProfileRoute } from "./profile.route";
import { registerAuthSessionRoutes } from "./session.route";
import { type AuthRouterDeps, type AuthRouterUseCases } from "./shared";

export type { AuthRouterDeps } from "./shared";

export interface AuthRouterModule {
  deps: AuthRouterDeps;
  useCases: AuthRouterUseCases;
}

export const createAuthRouter = ({ deps, useCases }: AuthRouterModule) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const jwtMiddleware = createJwtMiddleware({
    secret: deps.jwtSecret,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
  });

  registerAuthProfileRoute({ router, deps, useCases, jwtMiddleware });
  registerAuthEmailChangeRoutes({ router, deps, useCases, jwtMiddleware });
  registerAuthLoginRoute({ router, deps, useCases });
  registerAuthSessionRoutes({ router, deps, useCases, jwtMiddleware });
  registerAuthPasswordRoute({ router, deps, jwtMiddleware });
  registerAuthPasswordResetRoutes({ router, deps, useCases });
  registerAuthAvatarRoute({ router, deps, useCases, jwtMiddleware });
  registerAuthInvitationRoutes({ router, deps, useCases });

  return router;
};
