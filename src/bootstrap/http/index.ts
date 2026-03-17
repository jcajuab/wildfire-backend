import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { type RequestIdVariables } from "hono/request-id";
import { openAPIRouteHandler } from "hono-openapi";
import { createDefaultHealthDependencyChecks } from "#/bootstrap/http/health-checks";
import {
  createAIModule,
  createAuditHttpModule,
  createAuthHttpModule,
  createContentHttpModule,
  createDisplayRuntimeHttpModule,
  createDisplaysHttpModule,
  createPlaylistsHttpModule,
  createRbacHttpModule,
  createSchedulesHttpModule,
} from "#/bootstrap/http/modules";
import { startDisplayStatusReconciler } from "#/bootstrap/http/runtime/display-status-reconciler";
import { env } from "#/env";
import {
  contentJobEventPublisher,
  contentJobEventSubscription,
} from "#/infrastructure/content-jobs/event-publishers";
import { RedisContentIngestionQueue } from "#/infrastructure/content-jobs/redis-content-ingestion-queue";
import { closeDbConnection } from "#/infrastructure/db/client";
import {
  displayEventPublisher,
  displayEventSubscription,
  lifecycleEventPublisher,
  lifecycleEventSubscription,
  registrationAttemptEventPublisher,
  registrationAttemptEventSubscription,
} from "#/infrastructure/displays/event-publishers";
import { RedisDisplayRegistrationAttemptStore } from "#/infrastructure/displays/registration-attempt.store";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  createStartupRunId,
  logStartupPhaseDegraded,
  logStartupPhaseFailed,
  logStartupPhaseStarted,
  logStartupPhaseSucceeded,
} from "#/infrastructure/observability/startup-logging";
import { closeRedisClients } from "#/infrastructure/redis/client";
import { RedisAuditQueue } from "#/interfaces/http/audit/redis-audit-queue";
import { createAuditTrailMiddleware } from "#/interfaces/http/middleware/audit-trail";
import {
  requestId,
  requestLogger,
} from "#/interfaces/http/middleware/observability";
import { internalServerError } from "#/interfaces/http/responses";
import { createAIRouter } from "#/interfaces/http/routes/ai";
import { createAuditRouter } from "#/interfaces/http/routes/audit";
import { createAuthRouter } from "#/interfaces/http/routes/auth";
import { createContentRouter } from "#/interfaces/http/routes/content";
import { createContentJobsRouter } from "#/interfaces/http/routes/content-jobs.route";
import { createDisplayRouter } from "#/interfaces/http/routes/display-runtime";
import { createDisplaysRouter } from "#/interfaces/http/routes/displays";
import { createHealthRouter } from "#/interfaces/http/routes/health.route";
import { createPlaylistsRouter } from "#/interfaces/http/routes/playlists";
import { createRbacRouter } from "#/interfaces/http/routes/rbac";
import { createSchedulesRouter } from "#/interfaces/http/routes/schedules";
import { RedisAuthSecurityStore } from "#/interfaces/http/security/redis-auth-security.store";
import { runStartupAuthIdentitySync } from "#/interfaces/http/startup/auth-identity.sync";
import packageJSON from "#/package.json" with { type: "json" };
import { createHttpContainer } from "./container";

export const app = new Hono<{ Variables: RequestIdVariables }>();

const tokenTtlSeconds = env.PRESIGNED_URL_TTL_SECONDS;
const avatarUrlExpiresInSeconds = env.PRESIGNED_URL_TTL_SECONDS;
const contentThumbnailUrlExpiresInSeconds = env.PRESIGNED_URL_TTL_SECONDS;

type StartupMode = "failed" | "degraded";

interface HttpStorageStartupState {
  ensureBucketOk: boolean;
  connectivityOk: boolean;
  lastError?: string;
  lastCheckedAt: number | null;
  status: StartupMode | "success" | "not-checked";
}

const authSecurityStore = new RedisAuthSecurityStore();
const contentIngestionQueue = new RedisContentIngestionQueue({
  enabled: true,
  maxStreamLength: env.CONTENT_INGEST_QUEUE_CAPACITY,
  streamName: env.REDIS_STREAM_CONTENT_INGEST_NAME,
  enqueueMaxAttempts: env.CONTENT_INGEST_QUEUE_ENQUEUE_MAX_ATTEMPTS,
  enqueueBaseDelayMs: env.CONTENT_INGEST_QUEUE_ENQUEUE_BASE_DELAY_MS,
  enqueueMaxDelayMs: env.CONTENT_INGEST_QUEUE_ENQUEUE_MAX_DELAY_MS,
  enqueueTimeoutMs: env.CONTENT_INGEST_QUEUE_ENQUEUE_TIMEOUT_MS,
});

const registrationAttemptStore = new RedisDisplayRegistrationAttemptStore();

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

const storageStartupContext = {
  component: "api-bootstrap",
  phase: "storage",
};

export const syncAuthIdentityOnStartup = () =>
  runStartupAuthIdentitySync({
    htshadowPath: env.HTSHADOW_PATH,
    adminUsername: env.ADMIN_USERNAME,
    adminEmail: env.ADMIN_EMAIL ?? null,
    adminPassword: env.ADMIN_PASSWORD,
    repositories: {
      userRepository: container.repositories.userRepository,
      roleRepository: container.repositories.roleRepository,
      permissionRepository: container.repositories.permissionRepository,
      rolePermissionRepository: container.repositories.rolePermissionRepository,
      userRoleRepository: container.repositories.userRoleRepository,
    },
  });

let stopDisplayStatusReconciler: (() => Promise<void>) | null = null;
const getStorageConfig = () => ({
  minioEndpoint: container.storage.minioEndpoint,
  bucket: env.MINIO_BUCKET,
});
const storageStartupState: HttpStorageStartupState = {
  ensureBucketOk: false,
  connectivityOk: false,
  lastCheckedAt: null,
  status: "not-checked",
};

export const getStorageStartupState = (): HttpStorageStartupState => ({
  ...storageStartupState,
});

const startDisplayStatusReconcilerWorker = (): void => {
  if (stopDisplayStatusReconciler != null) {
    return;
  }
  stopDisplayStatusReconciler = startDisplayStatusReconciler({
    displayRepository: container.repositories.displayRepository,
    scheduleRepository: container.repositories.scheduleRepository,
    lifecycleEventPublisher,
    scheduleTimeZone: env.SCHEDULE_TIMEZONE,
  });
};

export const startHttpBackgroundWorkers = (): void => {
  startDisplayStatusReconcilerWorker();
};

const toStorageErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const runStorageBootstrapChecks = async (): Promise<void> => {
  const storageConfig = getStorageConfig();
  const startupContext = {
    ...storageStartupContext,
    runId: createStartupRunId("minio-bootstrap"),
  };
  const startedAtMs = Date.now();
  storageStartupState.lastCheckedAt = startedAtMs;
  storageStartupState.status = "failed";

  logger.info(
    {
      component: "api-bootstrap",
      event: "storage.minio.configured",
      ...storageConfig,
    },
    "MinIO storage configured",
  );

  const bucketStartupStartedAt = Date.now();
  logStartupPhaseStarted(
    {
      ...startupContext,
      operation: "ensure-bucket-exists",
    },
    storageConfig,
  );

  try {
    await container.storage.contentStorage.ensureBucketExists();
    storageStartupState.ensureBucketOk = true;
    storageStartupState.lastError = undefined;
    logStartupPhaseSucceeded(
      {
        ...startupContext,
        operation: "ensure-bucket-exists",
      },
      Date.now() - bucketStartupStartedAt,
      storageConfig,
    );
  } catch (error) {
    const errorMessage = toStorageErrorMessage(error);
    storageStartupState.ensureBucketOk = false;
    storageStartupState.connectivityOk = false;
    storageStartupState.lastError = errorMessage;
    storageStartupState.status = env.STARTUP_STRICT_STORAGE
      ? "failed"
      : "degraded";
    logStartupPhaseFailed(
      {
        ...startupContext,
        operation: "ensure-bucket-exists",
      },
      Date.now() - bucketStartupStartedAt,
      error,
      storageConfig,
    );
    if (env.STARTUP_STRICT_STORAGE) {
      throw error;
    }

    return;
  }

  const connectivityStartedAt = Date.now();
  logStartupPhaseStarted(
    {
      ...startupContext,
      operation: "check-connectivity",
    },
    storageConfig,
  );
  try {
    const result = await container.storage.contentStorage.checkConnectivity();
    storageStartupState.connectivityOk = result.ok;

    const durationMs = Date.now() - connectivityStartedAt;
    if (result.ok) {
      storageStartupState.status = "success";
      storageStartupState.lastError = undefined;
      logStartupPhaseSucceeded(
        {
          ...startupContext,
          operation: "check-connectivity",
        },
        durationMs,
        storageConfig,
      );
      return;
    }

    storageStartupState.status = "degraded";
    storageStartupState.lastError =
      result.error ?? "MinIO connectivity check failed without error detail";
    logStartupPhaseDegraded(
      {
        ...startupContext,
        operation: "check-connectivity",
      },
      durationMs,
      "MinIO connectivity check failed. Avatar/content uploads may fail while uploads are requested.",
      {
        ...storageConfig,
      },
      result.error != null ? new Error(result.error) : undefined,
    );
    if (env.STARTUP_STRICT_STORAGE) {
      throw new Error(storageStartupState.lastError);
    }
  } catch (error) {
    storageStartupState.connectivityOk = false;
    storageStartupState.status = env.STARTUP_STRICT_STORAGE
      ? "failed"
      : "degraded";
    storageStartupState.lastError = toStorageErrorMessage(error);
    logStartupPhaseFailed(
      {
        ...startupContext,
        operation: "check-connectivity",
      },
      Date.now() - connectivityStartedAt,
      error,
      storageConfig,
    );
    if (env.STARTUP_STRICT_STORAGE) {
      throw error;
    }
  }
};

logger.info(
  {
    component: "api-bootstrap",
    event: "storage.bootstrap_not_started",
    minioEndpoint: container.storage.minioEndpoint,
    bucket: env.MINIO_BUCKET,
  },
  "MinIO storage bootstrap deferred until startup orchestration",
);

const healthRouter = createHealthRouter(
  createDefaultHealthDependencyChecks({
    healthCheckTimeoutMs: env.HEALTH_CHECK_TIMEOUT_MS,
    redisAuditStreamName: env.REDIS_STREAM_AUDIT_NAME,
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
  }),
);

const authModule = createAuthHttpModule({
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
  authSecurityStore,
  authLoginRateLimitMaxAttempts: env.AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  authLoginRateLimitWindowSeconds: env.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  authLoginLockoutThreshold: env.AUTH_LOGIN_LOCKOUT_THRESHOLD,
  authLoginLockoutSeconds: env.AUTH_LOGIN_LOCKOUT_SECONDS,
  trustProxyHeaders: env.TRUST_PROXY_HEADERS,
  invitationRepository: container.repositories.invitationRepository,
  inviteTokenTtlSeconds: env.INVITE_TOKEN_TTL_SECONDS,
  inviteAcceptBaseUrl: env.INVITE_ACCEPT_BASE_URL,
  includeDevelopmentInviteUrls: env.NODE_ENV === "development",
  avatarStorage: container.storage.contentStorage,
  avatarUrlExpiresInSeconds,
});
const authRouter = createAuthRouter(authModule);

const playlistsModule = createPlaylistsHttpModule({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  repositories: {
    playlistRepository: container.repositories.playlistRepository,
    contentRepository: container.repositories.contentRepository,
    userRepository: container.repositories.userRepository,
    authorizationRepository: container.repositories.authorizationRepository,
    scheduleRepository: container.repositories.scheduleRepository,
    displayRepository: container.repositories.displayRepository,
  },
  storage: container.storage.contentStorage,
  thumbnailUrlExpiresInSeconds: contentThumbnailUrlExpiresInSeconds,
  displayEventPublisher,
});
const playlistsRouter = createPlaylistsRouter(playlistsModule);

const schedulesModule = createSchedulesHttpModule({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  timezone: env.SCHEDULE_TIMEZONE,
  repositories: {
    scheduleRepository: container.repositories.scheduleRepository,
    playlistRepository: container.repositories.playlistRepository,
    displayRepository: container.repositories.displayRepository,
    contentRepository: container.repositories.contentRepository,
    authorizationRepository: container.repositories.authorizationRepository,
  },
  displayEventPublisher,
});
const schedulesRouter = createSchedulesRouter(schedulesModule);

const displaysModule = createDisplaysHttpModule({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  downloadUrlExpiresInSeconds: env.PRESIGNED_URL_TTL_SECONDS,
  scheduleTimeZone: env.SCHEDULE_TIMEZONE,
  defaultEmergencyContentId: env.DEFAULT_EMERGENCY_CONTENT_ID,
  repositories: {
    displayRepository: container.repositories.displayRepository,
    scheduleRepository: container.repositories.scheduleRepository,
    playlistRepository: container.repositories.playlistRepository,
    contentRepository: container.repositories.contentRepository,
    runtimeControlRepository: container.repositories.runtimeControlRepository,
    authorizationRepository: container.repositories.authorizationRepository,
    displayGroupRepository: container.repositories.displayGroupRepository,
    displayPairingCodeRepository:
      container.repositories.displayPairingCodeRepository,
    displayPairingSessionRepository:
      container.repositories.displayPairingSessionRepository,
    displayKeyRepository: container.repositories.displayKeyRepository,
    displayPreviewRepository: container.repositories.displayPreviewRepository,
  },
  storage: container.storage.contentStorage,
  registrationAttemptStore,
  displayEventPublisher,
  lifecycleEventPublisher,
  lifecycleEventSubscription,
  registrationAttemptEventPublisher,
  registrationAttemptEventSubscription,
});
const displaysRouter = createDisplaysRouter(displaysModule);

const displayRuntimeModule = createDisplayRuntimeHttpModule({
  jwtSecret: env.JWT_SECRET,
  downloadUrlExpiresInSeconds: env.PRESIGNED_URL_TTL_SECONDS,
  scheduleTimeZone: env.SCHEDULE_TIMEZONE,
  authSecurityStore,
  rateLimits: {
    windowSeconds: env.DISPLAY_RUNTIME_RATE_LIMIT_WINDOW_SECONDS,
    authChallengeMaxAttempts: env.DISPLAY_RUNTIME_AUTH_CHALLENGE_MAX_ATTEMPTS,
    authVerifyMaxAttempts: env.DISPLAY_RUNTIME_AUTH_VERIFY_MAX_ATTEMPTS,
  },
  trustProxyHeaders: env.TRUST_PROXY_HEADERS,
  repositories: {
    displayRepository: container.repositories.displayRepository,
    scheduleRepository: container.repositories.scheduleRepository,
    playlistRepository: container.repositories.playlistRepository,
    contentRepository: container.repositories.contentRepository,
    runtimeControlRepository: container.repositories.runtimeControlRepository,
    displayKeyRepository: container.repositories.displayKeyRepository,
    displayAuthNonceRepository:
      container.repositories.displayAuthNonceRepository,
    displayPreviewRepository: container.repositories.displayPreviewRepository,
  },
  storage: container.storage.contentStorage,
  defaultEmergencyContentId: env.DEFAULT_EMERGENCY_CONTENT_ID,
  displayEventPublisher,
  displayEventSubscription,
  lifecycleEventPublisher,
});
const displayRouter = createDisplayRouter(displayRuntimeModule);

const contentModule = createContentHttpModule({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  maxUploadBytes: env.CONTENT_MAX_UPLOAD_BYTES,
  videoMaxUploadBytes: env.VIDEO_MAX_UPLOAD_BYTES,
  downloadUrlExpiresInSeconds: env.PRESIGNED_URL_TTL_SECONDS,
  thumbnailUrlExpiresInSeconds: contentThumbnailUrlExpiresInSeconds,
  repositories: {
    contentRepository: container.repositories.contentRepository,
    contentIngestionJobRepository:
      container.repositories.contentIngestionJobRepository,
    scheduleRepository: container.repositories.scheduleRepository,
    userRepository: container.repositories.userRepository,
    authorizationRepository: container.repositories.authorizationRepository,
  },
  storage: container.storage.contentStorage,
  contentIngestionQueue,
  contentMetadataExtractor: container.storage.contentMetadataExtractor,
  contentThumbnailGenerator: container.storage.contentThumbnailGenerator,
  contentJobEventPublisher,
  contentJobEventSubscription,
  displayEventPublisher,
  pdfCropSessionStore: container.storage.pdfCropSessionStore,
  pdfPageExtractor: container.storage.pdfPageExtractor,
  pdfCropRenderer: container.storage.pdfCropRenderer,
});
const contentRouter = createContentRouter(contentModule);

const contentJobsRouter = createContentJobsRouter(contentModule);

const rbacModule = createRbacHttpModule({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  credentialsRepository: container.auth.credentialsRepository,
  passwordHasher: container.auth.passwordHasher,
  repositories: {
    userRepository: container.repositories.userRepository,
    roleRepository: container.repositories.roleRepository,
    permissionRepository: container.repositories.permissionRepository,
    userRoleRepository: container.repositories.userRoleRepository,
    rolePermissionRepository: container.repositories.rolePermissionRepository,
    authorizationRepository: container.repositories.authorizationRepository,
  },
  avatarStorage: container.storage.contentStorage,
  avatarUrlExpiresInSeconds,
});
const rbacRouter = createRbacRouter(rbacModule);

const auditModule = createAuditHttpModule({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  exportMaxRows: env.AUDIT_EXPORT_MAX_ROWS,
  repositories: {
    auditLogRepository: container.repositories.auditLogRepository,
    authorizationRepository: container.repositories.authorizationRepository,
    userRepository: container.repositories.userRepository,
    displayRepository: container.repositories.displayRepository,
  },
});
const auditRouter = createAuditRouter(auditModule);

const auditQueue = new RedisAuditQueue({
  enabled: env.AUDIT_QUEUE_ENABLED,
  maxStreamLength: env.AUDIT_QUEUE_CAPACITY,
  streamName: env.REDIS_STREAM_AUDIT_NAME,
  enqueueMaxAttempts: env.AUDIT_QUEUE_ENQUEUE_MAX_ATTEMPTS,
  enqueueBaseDelayMs: env.AUDIT_QUEUE_ENQUEUE_BASE_DELAY_MS,
  enqueueMaxDelayMs: env.AUDIT_QUEUE_ENQUEUE_MAX_DELAY_MS,
  enqueueTimeoutMs: env.AUDIT_QUEUE_ENQUEUE_TIMEOUT_MS,
});

const aiModule = createAIModule({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  encryptionKey: env.AI_ENCRYPTION_KEY,
  rateLimitWindowSeconds: env.AI_RATE_LIMIT_WINDOW_SECONDS,
  rateLimitMaxRequests: env.AI_RATE_LIMIT_MAX_REQUESTS,
  auditQueue,
  repositories: {
    authorizationRepository: container.repositories.authorizationRepository,
    contentRepository: container.repositories.contentRepository,
    playlistRepository: container.repositories.playlistRepository,
    scheduleRepository: container.repositories.scheduleRepository,
    displayRepository: container.repositories.displayRepository,
    userRepository: container.repositories.userRepository,
    displayGroupRepository: container.repositories.displayGroupRepository,
  },
  storage: container.storage.contentStorage,
});
const aiRouter = createAIRouter(aiModule);

app.use(
  "*",
  cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-AI-Provider-Key",
      "X-Display-Slug",
      "X-Display-Key-Id",
      "X-Display-Timestamp",
      "X-Display-Nonce",
      "X-Display-Body-Sha256",
      "X-Display-Signature",
    ],
    exposeHeaders: ["X-Request-Id"],
  }),
);

// Security: Redact X-AI-Provider-Key from logs to prevent key leakage
app.use("*", async (c, next) => {
  await next();
  c.res.headers.delete("X-AI-Provider-Key");
});
app.use("*", requestId());
app.use(
  "*",
  createAuditTrailMiddleware({
    auditQueue,
    trustProxyHeaders: env.TRUST_PROXY_HEADERS,
  }),
);
app.use("*", requestLogger);

app.route("/api/v1/health", healthRouter);
app.route("/api/v1/auth", authRouter);
app.route("/api/v1/playlists", playlistsRouter);
app.route("/api/v1/schedules", schedulesRouter);
app.route("/api/v1/displays", displaysRouter);
app.route("/api/v1/display-runtime", displayRouter);
app.route("/api/v1/content", contentRouter);
app.route("/api/v1/content-jobs", contentJobsRouter);
app.route("/api/v1/audit", auditRouter);
app.route("/api/v1/ai", aiRouter);
app.route("/api/v1", rbacRouter);

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
    event: "http.request.error",
    component: "http",
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
    logger.error(addErrorContext(logPayload, err), "request error");
  } else {
    logger.warn(addErrorContext(logPayload, err), "request error");
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
  if (stopDisplayStatusReconciler) {
    await stopDisplayStatusReconciler();
    stopDisplayStatusReconciler = null;
  }
  await closeRedisClients();
  await closeDbConnection();
};
