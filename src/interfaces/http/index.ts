import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { type RequestIdVariables } from "hono/request-id";
import { openAPIRouteHandler } from "hono-openapi";
import { RecordAuditEventUseCase } from "#/application/use-cases/audit";
import {
  ChangeCurrentUserPasswordUseCase,
  SetCurrentUserAvatarUseCase,
  UpdateCurrentUserProfileUseCase,
} from "#/application/use-cases/auth";
import { DeleteCurrentUserUseCase } from "#/application/use-cases/rbac";
import { env } from "#/env";
import { logger } from "#/infrastructure/observability/logger";
import { InMemoryAuditQueue } from "#/interfaces/http/audit/in-memory-audit-queue";
import { createHttpContainer } from "#/interfaces/http/container";
import { createAuditTrailMiddleware } from "#/interfaces/http/middleware/audit-trail";
import {
  requestId,
  requestLogger,
} from "#/interfaces/http/middleware/observability";
import { internalServerError } from "#/interfaces/http/responses";
import { createAuditRouter } from "#/interfaces/http/routes/audit.route";
import { createAuthRouter } from "#/interfaces/http/routes/auth.route";
import { createContentRouter } from "#/interfaces/http/routes/content.route";
import { createDevicesRouter } from "#/interfaces/http/routes/devices.route";
import { healthRouter } from "#/interfaces/http/routes/health.route";
import { createPlaylistsRouter } from "#/interfaces/http/routes/playlists.route";
import { createRbacRouter } from "#/interfaces/http/routes/rbac.route";
import { createSchedulesRouter } from "#/interfaces/http/routes/schedules.route";
import { InMemoryAuthSecurityStore } from "#/interfaces/http/security/in-memory-auth-security.store";
import packageJSON from "#/package.json" with { type: "json" };

export const app = new Hono<{ Variables: RequestIdVariables }>();

const tokenTtlSeconds = 60 * 60;
const avatarUrlExpiresInSeconds = 60 * 60;
const authSecurityStore = new InMemoryAuthSecurityStore();
authSecurityStore.startCleanup();

const container = createHttpContainer({
  jwtSecret: env.JWT_SECRET,
  jwtIssuer: env.JWT_ISSUER,
  htshadowPath: env.HTSHADOW_PATH,
  minio: {
    endpoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSsl: env.MINIO_USE_SSL,
    bucket: env.MINIO_BUCKET,
    region: env.MINIO_REGION,
    rootUser: env.MINIO_ROOT_USER,
    rootPassword: env.MINIO_ROOT_PASSWORD,
    requestTimeoutMs: env.MINIO_REQUEST_TIMEOUT_MS,
  },
});

logger.info(
  {
    minioEndpoint: container.storage.minioEndpoint,
    bucket: env.MINIO_BUCKET,
  },
  "MinIO storage configured",
);

if (env.NODE_ENV === "development") {
  void container.storage.contentStorage.checkConnectivity().then((result) => {
    if (result.ok) {
      logger.info(
        "MinIO connectivity check OK. MinIO running at endpoint: " +
          container.storage.minioEndpoint,
      );
    } else {
      logger.warn(
        {
          minioEndpoint: container.storage.minioEndpoint,
          bucket: env.MINIO_BUCKET,
          error: result.error,
        },
        "MinIO connectivity check failed — avatar/content uploads will fail. Please check which ports your MinIO is running at and ensure connectivity.",
      );
    }
  });
}

const authRouter = createAuthRouter({
  credentialsRepository: container.auth.credentialsRepository,
  passwordVerifier: container.auth.passwordVerifier,
  passwordHasher: container.auth.passwordHasher,
  tokenIssuer: container.auth.tokenIssuer,
  clock: container.auth.clock,
  tokenTtlSeconds,
  userRepository: container.repositories.userRepository,
  authorizationRepository: container.repositories.authorizationRepository,
  jwtSecret: env.JWT_SECRET,
  issuer: env.JWT_ISSUER,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  authSessionDualMode: env.AUTH_SESSION_DUAL_MODE,
  authSecurityStore,
  authLoginRateLimitMaxAttempts: env.AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  authLoginRateLimitWindowSeconds: env.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  authLoginLockoutThreshold: env.AUTH_LOGIN_LOCKOUT_THRESHOLD,
  authLoginLockoutSeconds: env.AUTH_LOGIN_LOCKOUT_SECONDS,
  passwordResetTokenRepository:
    container.repositories.passwordResetTokenRepository,
  invitationRepository: container.repositories.invitationRepository,
  invitationEmailSender: container.auth.invitationEmailSender,
  inviteTokenTtlSeconds: env.INVITE_TOKEN_TTL_SECONDS,
  inviteAcceptBaseUrl: env.INVITE_ACCEPT_BASE_URL,
  deleteCurrentUserUseCase: new DeleteCurrentUserUseCase({
    userRepository: container.repositories.userRepository,
  }),
  updateCurrentUserProfileUseCase: new UpdateCurrentUserProfileUseCase({
    userRepository: container.repositories.userRepository,
  }),
  changeCurrentUserPasswordUseCase: new ChangeCurrentUserPasswordUseCase({
    userRepository: container.repositories.userRepository,
    credentialsRepository: container.auth.credentialsRepository,
    passwordVerifier: container.auth.passwordVerifier,
    passwordHasher: container.auth.passwordHasher,
  }),
  setCurrentUserAvatarUseCase: new SetCurrentUserAvatarUseCase({
    userRepository: container.repositories.userRepository,
    storage: container.storage.contentStorage,
  }),
  avatarStorage: container.storage.contentStorage,
  avatarUrlExpiresInSeconds,
});

const playlistsRouter = createPlaylistsRouter({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  authSessionDualMode: env.AUTH_SESSION_DUAL_MODE,
  repositories: {
    playlistRepository: container.repositories.playlistRepository,
    contentRepository: container.repositories.contentRepository,
    userRepository: container.repositories.userRepository,
    authorizationRepository: container.repositories.authorizationRepository,
  },
});

const schedulesRouter = createSchedulesRouter({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  authSessionDualMode: env.AUTH_SESSION_DUAL_MODE,
  repositories: {
    scheduleRepository: container.repositories.scheduleRepository,
    playlistRepository: container.repositories.playlistRepository,
    deviceRepository: container.repositories.deviceRepository,
    authorizationRepository: container.repositories.authorizationRepository,
  },
});

const devicesRouter = createDevicesRouter({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  authSessionDualMode: env.AUTH_SESSION_DUAL_MODE,
  deviceApiKey: env.DEVICE_API_KEY,
  downloadUrlExpiresInSeconds: 60 * 60,
  scheduleTimeZone: env.SCHEDULE_TIMEZONE,
  repositories: {
    deviceRepository: container.repositories.deviceRepository,
    scheduleRepository: container.repositories.scheduleRepository,
    playlistRepository: container.repositories.playlistRepository,
    contentRepository: container.repositories.contentRepository,
    authorizationRepository: container.repositories.authorizationRepository,
    deviceGroupRepository: container.repositories.deviceGroupRepository,
  },
  storage: container.storage.contentStorage,
});

const contentRouter = createContentRouter({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  authSessionDualMode: env.AUTH_SESSION_DUAL_MODE,
  maxUploadBytes: env.CONTENT_MAX_UPLOAD_BYTES,
  downloadUrlExpiresInSeconds: 60 * 60,
  repositories: {
    contentRepository: container.repositories.contentRepository,
    userRepository: container.repositories.userRepository,
    authorizationRepository: container.repositories.authorizationRepository,
  },
  storage: container.storage.contentStorage,
});

const rbacRouter = createRbacRouter({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  authSessionDualMode: env.AUTH_SESSION_DUAL_MODE,
  repositories: {
    userRepository: container.repositories.userRepository,
    roleRepository: container.repositories.roleRepository,
    permissionRepository: container.repositories.permissionRepository,
    userRoleRepository: container.repositories.userRoleRepository,
    rolePermissionRepository: container.repositories.rolePermissionRepository,
    roleDeletionRequestRepository:
      container.repositories.roleDeletionRequestRepository,
    policyHistoryRepository: container.repositories.policyHistoryRepository,
    authorizationRepository: container.repositories.authorizationRepository,
  },
  avatarStorage: container.storage.contentStorage,
  avatarUrlExpiresInSeconds,
});

const auditRouter = createAuditRouter({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  authSessionDualMode: env.AUTH_SESSION_DUAL_MODE,
  exportMaxRows: env.AUDIT_EXPORT_MAX_ROWS,
  repositories: {
    auditEventRepository: container.repositories.auditEventRepository,
    authorizationRepository: container.repositories.authorizationRepository,
    userRepository: container.repositories.userRepository,
    deviceRepository: container.repositories.deviceRepository,
  },
});

const recordAuditEvent = new RecordAuditEventUseCase({
  auditEventRepository: container.repositories.auditEventRepository,
});
const auditQueue = new InMemoryAuditQueue(
  {
    enabled: env.AUDIT_QUEUE_ENABLED,
    capacity: env.AUDIT_QUEUE_CAPACITY,
    flushBatchSize: env.AUDIT_FLUSH_BATCH_SIZE,
    flushIntervalMs: env.AUDIT_FLUSH_INTERVAL_MS,
  },
  {
    recordAuditEvent,
  },
);

app.use(
  "*",
  cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
  }),
);
app.use("*", requestId());
app.use("*", createAuditTrailMiddleware({ auditQueue }));
app.use("*", requestLogger);

app.route("/", healthRouter);
app.route("/auth", authRouter);
app.route("/playlists", playlistsRouter);
app.route("/schedules", schedulesRouter);
app.route("/devices", devicesRouter);
app.route("/content", contentRouter);
app.route("/audit", auditRouter);
app.route("/", rbacRouter);

app.onError((err, c) => {
  const status = err instanceof HTTPException ? err.status : 500;
  const getVar = <T = unknown>(key: string): T | undefined =>
    (c as { get: (name: string) => T | undefined }).get(key);
  const route = getVar<string>("route") ?? c.req.path;
  const actorId = getVar<string>("actorId") ?? getVar<string>("userId");
  const actorType =
    getVar<string>("actorType") ?? (actorId ? "user" : undefined);
  const resourceId = getVar<string>("resourceId");
  const resourceType = getVar<string>("resourceType");
  const sessionId = getVar<string>("sessionId");
  const fileId =
    getVar<string>("fileId") ??
    (resourceType === "content" && resourceId != null ? resourceId : undefined);
  const logPayload = {
    err,
    requestId: c.get("requestId"),
    method: c.req.method,
    path: c.req.path,
    route,
    status,
    actorId,
    actorType,
    resourceId,
    resourceType,
    sessionId,
    fileId,
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

export const stopHttpBackgroundWorkers = async (): Promise<void> => {
  await auditQueue.stop();
};
