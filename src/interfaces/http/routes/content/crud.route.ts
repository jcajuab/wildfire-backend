import { registerContentReadRoutes } from "./read.route";
import {
  type ContentRouter,
  type ContentRouterUseCases,
  type RequirePermission,
} from "./shared";
import { registerContentWriteRoutes } from "./write.route";

export const registerContentCrudRoutes = (args: {
  router: ContentRouter;
  useCases: ContentRouterUseCases;
  requirePermission: RequirePermission;
  maxUploadBytes: number;
}) => {
  registerContentReadRoutes(args);
  registerContentWriteRoutes(args);
};
