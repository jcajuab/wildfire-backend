import {
  type AuthorizePermission,
  type RbacRouter,
  type RbacRouterDeps,
  type RbacRouterUseCases,
} from "./shared";
import { registerRbacUserMembershipRoutes } from "./user-memberships.route";
import { registerRbacUserResourceRoutes } from "./users-resource.route";

export const registerRbacUserRoutes = (args: {
  router: RbacRouter;
  deps: RbacRouterDeps;
  useCases: RbacRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  registerRbacUserResourceRoutes(args);
  registerRbacUserMembershipRoutes(args);
};
