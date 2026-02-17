import { registerRbacRoleUserRoutes } from "./role-users.route";
import { registerRbacRoleCrudRoutes } from "./roles-crud.route";
import {
  type AuthorizePermission,
  type RbacRouter,
  type RbacRouterDeps,
  type RbacRouterUseCases,
} from "./shared";

export const registerRbacRoleRoutes = (args: {
  router: RbacRouter;
  deps: RbacRouterDeps;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  registerRbacRoleCrudRoutes(args);
  registerRbacRoleUserRoutes(args);
};
