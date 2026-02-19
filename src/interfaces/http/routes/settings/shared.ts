import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type DeviceRepository } from "#/application/ports/devices";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { type SystemSettingRepository } from "#/application/ports/settings";
import {
  GetDeviceRuntimeSettingsUseCase,
  UpdateDeviceRuntimeSettingsUseCase,
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
    deviceRepository: DeviceRepository;
  };
}

export interface SettingsRouterUseCases {
  getDeviceRuntimeSettings: GetDeviceRuntimeSettingsUseCase;
  updateDeviceRuntimeSettings: UpdateDeviceRuntimeSettingsUseCase;
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
  getDeviceRuntimeSettings: new GetDeviceRuntimeSettingsUseCase({
    systemSettingRepository: deps.repositories.systemSettingRepository,
  }),
  updateDeviceRuntimeSettings: new UpdateDeviceRuntimeSettingsUseCase({
    systemSettingRepository: deps.repositories.systemSettingRepository,
  }),
});
