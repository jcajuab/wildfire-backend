import { timingSafeEqual } from "node:crypto";
import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type DeviceGroupRepository,
  type DeviceRepository,
} from "#/application/ports/devices";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  CreateDeviceGroupUseCase,
  DeleteDeviceGroupUseCase,
  GetDeviceActiveScheduleUseCase,
  GetDeviceManifestUseCase,
  GetDeviceUseCase,
  ListDeviceGroupsUseCase,
  ListDevicesUseCase,
  RegisterDeviceUseCase,
  SetDeviceGroupsUseCase,
  UpdateDeviceGroupUseCase,
  UpdateDeviceUseCase,
} from "#/application/use-cases/devices";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { unauthorized } from "#/interfaces/http/responses";

export interface DevicesRouterDeps {
  jwtSecret: string;
  authSessionRepository?: AuthSessionRepository;
  authSessionCookieName?: string;
  authSessionDualMode?: boolean;
  deviceApiKey: string;
  downloadUrlExpiresInSeconds: number;
  scheduleTimeZone?: string;
  repositories: {
    deviceRepository: DeviceRepository;
    scheduleRepository: ScheduleRepository;
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    authorizationRepository: AuthorizationRepository;
    deviceGroupRepository: DeviceGroupRepository;
  };
  storage: ContentStorage;
}

export interface DevicesRouterUseCases {
  listDevices: ListDevicesUseCase;
  getDevice: GetDeviceUseCase;
  updateDevice: UpdateDeviceUseCase;
  registerDevice: RegisterDeviceUseCase;
  listDeviceGroups: ListDeviceGroupsUseCase;
  createDeviceGroup: CreateDeviceGroupUseCase;
  updateDeviceGroup: UpdateDeviceGroupUseCase;
  deleteDeviceGroup: DeleteDeviceGroupUseCase;
  setDeviceGroups: SetDeviceGroupsUseCase;
  getActiveSchedule: GetDeviceActiveScheduleUseCase;
  getManifest: GetDeviceManifestUseCase;
}

export type DevicesRouter = Hono<{ Variables: JwtUserVariables }>;

export type DeviceAuthMiddleware = MiddlewareHandler<{
  Variables: JwtUserVariables;
}>;

export const deviceTags = ["Devices"];

export const createDevicesUseCases = (
  deps: DevicesRouterDeps,
): DevicesRouterUseCases => ({
  listDevices: new ListDevicesUseCase({
    deviceRepository: deps.repositories.deviceRepository,
  }),
  getDevice: new GetDeviceUseCase({
    deviceRepository: deps.repositories.deviceRepository,
  }),
  updateDevice: new UpdateDeviceUseCase({
    deviceRepository: deps.repositories.deviceRepository,
  }),
  registerDevice: new RegisterDeviceUseCase({
    deviceRepository: deps.repositories.deviceRepository,
  }),
  listDeviceGroups: new ListDeviceGroupsUseCase({
    deviceGroupRepository: deps.repositories.deviceGroupRepository,
  }),
  createDeviceGroup: new CreateDeviceGroupUseCase({
    deviceGroupRepository: deps.repositories.deviceGroupRepository,
  }),
  updateDeviceGroup: new UpdateDeviceGroupUseCase({
    deviceGroupRepository: deps.repositories.deviceGroupRepository,
  }),
  deleteDeviceGroup: new DeleteDeviceGroupUseCase({
    deviceGroupRepository: deps.repositories.deviceGroupRepository,
  }),
  setDeviceGroups: new SetDeviceGroupsUseCase({
    deviceRepository: deps.repositories.deviceRepository,
    deviceGroupRepository: deps.repositories.deviceGroupRepository,
  }),
  getActiveSchedule: new GetDeviceActiveScheduleUseCase({
    scheduleRepository: deps.repositories.scheduleRepository,
    playlistRepository: deps.repositories.playlistRepository,
    deviceRepository: deps.repositories.deviceRepository,
    scheduleTimeZone: deps.scheduleTimeZone,
  }),
  getManifest: new GetDeviceManifestUseCase({
    scheduleRepository: deps.repositories.scheduleRepository,
    playlistRepository: deps.repositories.playlistRepository,
    contentRepository: deps.repositories.contentRepository,
    contentStorage: deps.storage,
    deviceRepository: deps.repositories.deviceRepository,
    downloadUrlExpiresInSeconds: deps.downloadUrlExpiresInSeconds,
    scheduleTimeZone: deps.scheduleTimeZone,
  }),
});

const safeCompare = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

export const createRequireDeviceApiKey = (
  apiKey: string,
): DeviceAuthMiddleware => {
  return async (c, next) => {
    const header = c.req.header("x-api-key");
    if (!header || !safeCompare(header, apiKey)) {
      return unauthorized(c, "Invalid API key");
    }
    await next();
  };
};
