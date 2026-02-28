import { registerRbacRoleDeletionRequestRoutes } from "./role-deletion-requests.route";
import { registerRbacRoleMembershipRoutes } from "./role-memberships.route";
import { registerRbacRoleReadRoutes } from "./roles-read.route";
import { registerRbacRoleWriteRoutes } from "./roles-write.route";
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
  registerRbacRoleDeletionRequestRoutes(args);
  registerRbacRoleReadRoutes(args);
  registerRbacRoleWriteRoutes(args);
  registerRbacRoleMembershipRoutes(args);
};
