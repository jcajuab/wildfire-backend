import {
  type AuthorizePermission,
  type DisplaysRouter,
  type DisplaysRouterDeps,
  type DisplaysRouterUseCases,
} from "../module";
import { registerDisplayStaffGroupRoutes } from "./display-groups.route";
import { registerDisplayStaffDisplayRoutes } from "./displays.route";
import { registerDisplayStaffEventRoutes } from "./events.route";
import { registerDisplayStaffRegistrationRoutes } from "./registration.route";
import { registerDisplayStaffRegistrationAttemptRoutes } from "./registration-attempts.route";
import { registerDisplayStaffRuntimeOverrideRoutes } from "./runtime-overrides.route";

export const registerDisplayStaffRoutes = (input: {
  router: DisplaysRouter;
  deps: DisplaysRouterDeps;
  useCases: DisplaysRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  registerDisplayStaffEventRoutes(input);
  registerDisplayStaffRegistrationAttemptRoutes(input);
  registerDisplayStaffRegistrationRoutes(input);
  registerDisplayStaffRuntimeOverrideRoutes(input);
  registerDisplayStaffDisplayRoutes(input);
  registerDisplayStaffGroupRoutes(input);
};
