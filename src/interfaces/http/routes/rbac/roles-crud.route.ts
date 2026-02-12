import { registerRbacRoleMutateRoutes } from "./roles-mutate.route";
import { registerRbacRoleQueryRoutes } from "./roles-query.route";
import {
  type AuthorizePermission,
  type RbacRouter,
  type RbacRouterUseCases,
} from "./shared";

export const registerRbacRoleCrudRoutes = (args: {
  router: RbacRouter;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  registerRbacRoleQueryRoutes(args);
  registerRbacRoleMutateRoutes(args);
};
