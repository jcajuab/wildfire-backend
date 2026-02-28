import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type DisplayRepository } from "#/application/ports/displays";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { type SystemSettingRepository } from "#/application/ports/settings";
import {
  GetDisplayRuntimeSettingsUseCase,
  UpdateDisplayRuntimeSettingsUseCase,
} from "#/application/use-cases/settings";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";

export interface SettingsRouterDeps {
  jwtSecret: string;
  authSessionRepository?: AuthSessionRepository;
  authSessionCookieName?: string;
  authSessionDualMode?: boolean;
  repositories: {
    authorizationRepository: AuthorizationRepository;
    systemSettingRepository: SystemSettingRepository;
    displayRepository: DisplayRepository;
  };
}

export interface SettingsRouterUseCases {
  getDisplayRuntimeSettings: GetDisplayRuntimeSettingsUseCase;
  updateDisplayRuntimeSettings: UpdateDisplayRuntimeSettingsUseCase;
}

export type SettingsRouter = Hono<{ Variables: JwtUserVariables }>;

export type AuthorizePermission = (
  permission: string,
) => readonly [
  MiddlewareHandler,
  MiddlewareHandler<{ Variables: JwtUserVariables }>,
];

export const settingsTags = ["Settings"];

export const createSettingsUseCases = (
  deps: SettingsRouterDeps,
): SettingsRouterUseCases => ({
  getDisplayRuntimeSettings: new GetDisplayRuntimeSettingsUseCase({
    systemSettingRepository: deps.repositories.systemSettingRepository,
  }),
  updateDisplayRuntimeSettings: new UpdateDisplayRuntimeSettingsUseCase({
    systemSettingRepository: deps.repositories.systemSettingRepository,
  }),
});
