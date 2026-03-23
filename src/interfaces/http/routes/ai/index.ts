import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerAIChatRoutes } from "./chat.route";
import { registerAICredentialRoutes } from "./credentials.route";
import { type AIRouterDeps, type AIRouterUseCases } from "./shared";

export type { AIRouterDeps } from "./shared";

export interface AIRouterModule {
  deps: AIRouterDeps;
  useCases: AIRouterUseCases;
}

export const createAIRouter = ({ deps, useCases }: AIRouterModule) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    checkPermissionUseCase: deps.checkPermissionUseCase,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
  });

  registerAIChatRoutes({
    router,
    useCases,
    authorize,
    authSecurityStore: deps.authSecurityStore,
    rateLimitWindowSeconds: deps.rateLimitWindowSeconds,
    rateLimitMaxRequests: deps.rateLimitMaxRequests,
  });
  registerAICredentialRoutes({ router, useCases, authorize });

  return router;
};
