import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { type RequestIdVariables } from "hono/request-id";
import { openAPIRouteHandler } from "hono-openapi";
import { DeleteCurrentUserUseCase } from "#/application/use-cases/rbac";
import { env } from "#/env";
import { BcryptPasswordVerifier } from "#/infrastructure/auth/bcrypt-password.verifier";
import { HtshadowCredentialsRepository } from "#/infrastructure/auth/htshadow.repo";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { AuthorizationDbRepository } from "#/infrastructure/db/repositories/authorization.repo";
import { ContentDbRepository } from "#/infrastructure/db/repositories/content.repo";
import { DeviceDbRepository } from "#/infrastructure/db/repositories/device.repo";
import { PermissionDbRepository } from "#/infrastructure/db/repositories/permission.repo";
import { PlaylistDbRepository } from "#/infrastructure/db/repositories/playlist.repo";
import { RoleDbRepository } from "#/infrastructure/db/repositories/role.repo";
import { RolePermissionDbRepository } from "#/infrastructure/db/repositories/role-permission.repo";
import { ScheduleDbRepository } from "#/infrastructure/db/repositories/schedule.repo";
import { UserDbRepository } from "#/infrastructure/db/repositories/user.repo";
import { UserRoleDbRepository } from "#/infrastructure/db/repositories/user-role.repo";
import { logger } from "#/infrastructure/observability/logger";
import { S3ContentStorage } from "#/infrastructure/storage/s3-content.storage";
import { SystemClock } from "#/infrastructure/time/system.clock";
import {
  requestId,
  requestLogger,
} from "#/interfaces/http/middleware/observability";
import { internalServerError } from "#/interfaces/http/responses";
import { createAuthRouter } from "#/interfaces/http/routes/auth.route";
import { createContentRouter } from "#/interfaces/http/routes/content.route";
import { createDevicesRouter } from "#/interfaces/http/routes/devices.route";
import { healthRouter } from "#/interfaces/http/routes/health.route";
import { createPlaylistsRouter } from "#/interfaces/http/routes/playlists.route";
import { createRbacRouter } from "#/interfaces/http/routes/rbac.route";
import { createSchedulesRouter } from "#/interfaces/http/routes/schedules.route";
import packageJSON from "#/package.json" with { type: "json" };

export const app = new Hono<{ Variables: RequestIdVariables }>();

app.use(
  "*",
  cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
  }),
);
app.use("*", requestId());
app.use("*", requestLogger);

const tokenTtlSeconds = 60 * 60;
const userRepository = new UserDbRepository();
const authRouter = createAuthRouter({
  credentialsRepository: new HtshadowCredentialsRepository({
    filePath: env.HTSHADOW_PATH,
  }),
  passwordVerifier: new BcryptPasswordVerifier(),
  tokenIssuer: new JwtTokenIssuer({
    secret: env.JWT_SECRET,
    issuer: env.JWT_ISSUER,
  }),
  clock: new SystemClock(),
  userRepository,
  authorizationRepository: new AuthorizationDbRepository(),
  tokenTtlSeconds,
  issuer: env.JWT_ISSUER,
  jwtSecret: env.JWT_SECRET,
  deleteCurrentUserUseCase: new DeleteCurrentUserUseCase({ userRepository }),
});

app.route("/", healthRouter);
app.route("/auth", authRouter);
const playlistsRouter = createPlaylistsRouter({
  jwtSecret: env.JWT_SECRET,
  repositories: {
    playlistRepository: new PlaylistDbRepository(),
    contentRepository: new ContentDbRepository(),
    userRepository: new UserDbRepository(),
    authorizationRepository: new AuthorizationDbRepository(),
  },
});

const schedulesRouter = createSchedulesRouter({
  jwtSecret: env.JWT_SECRET,
  repositories: {
    scheduleRepository: new ScheduleDbRepository(),
    playlistRepository: new PlaylistDbRepository(),
    deviceRepository: new DeviceDbRepository(),
    authorizationRepository: new AuthorizationDbRepository(),
  },
});

app.route("/playlists", playlistsRouter);
const contentStorage = new S3ContentStorage({
  bucket: env.MINIO_BUCKET,
  region: env.MINIO_REGION,
  endpoint: `${env.MINIO_USE_SSL ? "https" : "http"}://${
    env.MINIO_ENDPOINT
  }:${env.MINIO_PORT}`,
  accessKeyId: env.MINIO_ROOT_USER,
  secretAccessKey: env.MINIO_ROOT_PASSWORD,
});

app.route("/schedules", schedulesRouter);
const devicesRouter = createDevicesRouter({
  jwtSecret: env.JWT_SECRET,
  deviceApiKey: env.DEVICE_API_KEY,
  downloadUrlExpiresInSeconds: 60 * 60,
  scheduleTimeZone: env.SCHEDULE_TIMEZONE,
  repositories: {
    deviceRepository: new DeviceDbRepository(),
    scheduleRepository: new ScheduleDbRepository(),
    playlistRepository: new PlaylistDbRepository(),
    contentRepository: new ContentDbRepository(),
    authorizationRepository: new AuthorizationDbRepository(),
  },
  storage: contentStorage,
});

app.route("/devices", devicesRouter);

const contentRouter = createContentRouter({
  jwtSecret: env.JWT_SECRET,
  maxUploadBytes: env.CONTENT_MAX_UPLOAD_BYTES,
  downloadUrlExpiresInSeconds: 60 * 60,
  repositories: {
    contentRepository: new ContentDbRepository(),
    userRepository: new UserDbRepository(),
    authorizationRepository: new AuthorizationDbRepository(),
  },
  storage: contentStorage,
});

app.route("/content", contentRouter);

const rbacRouter = createRbacRouter({
  jwtSecret: env.JWT_SECRET,
  repositories: {
    userRepository: new UserDbRepository(),
    roleRepository: new RoleDbRepository(),
    permissionRepository: new PermissionDbRepository(),
    userRoleRepository: new UserRoleDbRepository(),
    rolePermissionRepository: new RolePermissionDbRepository(),
    authorizationRepository: new AuthorizationDbRepository(),
  },
});

app.route("/", rbacRouter);

app.onError((err, c) => {
  const status = err instanceof HTTPException ? err.status : 500;
  const logPayload = {
    err,
    requestId: c.get("requestId"),
    method: c.req.method,
    path: c.req.path,
    status,
  };

  if (status >= 500) {
    logger.error(logPayload, "request error");
  } else {
    logger.warn(logPayload, "request error");
  }

  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  return internalServerError(c, "Unexpected error");
});

if (env.NODE_ENV !== "production") {
  app.get(
    "/openapi.json",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: `${packageJSON.name.toUpperCase()} API Reference`,
          description: packageJSON.description,
          version: packageJSON.version,
        },
        servers: [{ url: `http://localhost:${env.PORT}` }],
      },
    }),
  );

  app.get("/docs", Scalar({ url: "/openapi.json" }));
}
