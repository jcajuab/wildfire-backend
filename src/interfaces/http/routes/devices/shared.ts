import { timingSafeEqual } from "node:crypto";
import { type Hono, type MiddlewareHandler } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type DeviceRepository } from "#/application/ports/devices";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  GetDeviceActiveScheduleUseCase,
  GetDeviceManifestUseCase,
  GetDeviceUseCase,
  ListDevicesUseCase,
  RegisterDeviceUseCase,
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
  };
  storage: ContentStorage;
}

export interface DevicesRouterUseCases {
  listDevices: ListDevicesUseCase;
  getDevice: GetDeviceUseCase;
  registerDevice: RegisterDeviceUseCase;
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
  registerDevice: new RegisterDeviceUseCase({
    deviceRepository: deps.repositories.deviceRepository,
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
