import {
  type AuthorizePermission,
  type RbacRouter,
  type RbacRouterDeps,
  type RbacRouterUseCases,
} from "./shared";
import { registerRbacUserRoleRoutes } from "./user-roles.route";
import { registerRbacUserCrudRoutes } from "./users-crud.route";

export const registerRbacUserRoutes = (args: {
  router: RbacRouter;
  deps: RbacRouterDeps;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  registerRbacUserCrudRoutes(args);
  registerRbacUserRoleRoutes(args);
};
