import { Hono } from "hono";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import { registerContentFileRoutes } from "./file.route";
import { registerPdfCropRoutes } from "./pdf-crop.route";
import { registerContentReadRoutes } from "./read.route";
import { type ContentRouterDeps, type ContentRouterUseCases } from "./shared";
import { registerContentWriteRoutes } from "./write.route";

export type { ContentRouterDeps } from "./shared";

export interface ContentRouterModule {
  deps: ContentRouterDeps;
  useCases: ContentRouterUseCases;
}

export const createContentRouter = ({
  deps,
  useCases,
}: ContentRouterModule) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const { jwtMiddleware, requirePermission } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    checkPermissionUseCase: deps.checkPermissionUseCase,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
  });

  router.use("/*", jwtMiddleware);

  registerContentReadRoutes({
    router,
    useCases,
    requirePermission,
  });
  registerContentWriteRoutes({
    router,
    useCases,
    requirePermission,
    maxUploadBytes: deps.maxUploadBytes,
    videoMaxUploadBytes: deps.videoMaxUploadBytes,
  });
  registerContentFileRoutes({
    router,
    useCases,
    requirePermission,
  });

  registerPdfCropRoutes({
    router,
    useCases: {
      initPdfCrop: useCases.initPdfCrop,
      submitPdfCrop: useCases.submitPdfCrop,
      cancelPdfCrop: useCases.cancelPdfCrop,
    },
    requirePermission,
    maxUploadBytes: deps.maxUploadBytes,
  });

  return router;
};
