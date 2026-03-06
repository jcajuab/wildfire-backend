import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { type RequestIdVariables } from "hono/request-id";
import { openAPIRouteHandler } from "hono-openapi";
import {
  ChangeCurrentUserPasswordUseCase,
  SetCurrentUserAvatarUseCase,
  UpdateCurrentUserProfileUseCase,
} from "#/application/use-cases/auth";
import { DeleteCurrentUserUseCase } from "#/application/use-cases/rbac";
import { env } from "#/env";
import { RedisContentIngestionQueue } from "#/infrastructure/content-jobs/redis-content-ingestion-queue";
import { closeDbConnection } from "#/infrastructure/db/client";
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
import { createHttpContainer } from "#/interfaces/http/container";
import { createAuditTrailMiddleware } from "#/interfaces/http/middleware/audit-trail";
import {
  requestId,
  requestLogger,
} from "#/interfaces/http/middleware/observability";
import {
  internalServerError,
  normalizeApiPayload,
} from "#/interfaces/http/responses";
import { createAuditRouter } from "#/interfaces/http/routes/audit.route";
import { createAuthRouter } from "#/interfaces/http/routes/auth.route";
import { createContentRouter } from "#/interfaces/http/routes/content.route";
import { createContentJobsRouter } from "#/interfaces/http/routes/content-jobs.route";
import { createDisplayRouter } from "#/interfaces/http/routes/display.route";
import { startDisplayStatusReconciler } from "#/interfaces/http/routes/displays/status-reconciler";
import { createDisplaysRouter } from "#/interfaces/http/routes/displays.route";
import { healthRouter } from "#/interfaces/http/routes/health.route";
import { createPlaylistsRouter } from "#/interfaces/http/routes/playlists.route";
import { createRbacRouter } from "#/interfaces/http/routes/rbac.route";
import { createSchedulesRouter } from "#/interfaces/http/routes/schedules.route";
import { RedisAuthSecurityStore } from "#/interfaces/http/security/redis-auth-security.store";
import { runStartupAuthIdentitySync } from "#/interfaces/http/startup/auth-identity.sync";
import packageJSON from "#/package.json" with { type: "json" };

export const app = new Hono<{ Variables: RequestIdVariables }>();

const tokenTtlSeconds = 60 * 60;
const avatarUrlExpiresInSeconds = 60 * 60;
const contentThumbnailUrlExpiresInSeconds = 60 * 60;

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
});

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
    rootUsername: env.ROOT_USERNAME,
    rootEmail: env.ROOT_EMAIL ?? null,
    rootPassword: env.ROOT_PASSWORD,
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
let storageStartupState: HttpStorageStartupState = {
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
  storageStartupState = {
    ...storageStartupState,
    lastCheckedAt: startedAtMs,
    status: "failed",
  };

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
    storageStartupState = {
      ...storageStartupState,
      ensureBucketOk: true,
      lastError: undefined,
    };
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
    storageStartupState = {
      ...storageStartupState,
      ensureBucketOk: false,
      connectivityOk: false,
      lastError: errorMessage,
      status: env.STARTUP_STRICT_STORAGE ? "failed" : "degraded",
    };
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
    storageStartupState = {
      ...storageStartupState,
      connectivityOk: result.ok,
    };

    const durationMs = Date.now() - connectivityStartedAt;
    if (result.ok) {
      storageStartupState = {
        ...storageStartupState,
        status: "success",
        lastError: undefined,
      };
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

    storageStartupState = {
      ...storageStartupState,
      status: "degraded",
      lastError:
        result.error ?? "MinIO connectivity check failed without error detail",
    };
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
    storageStartupState = {
      ...storageStartupState,
      connectivityOk: false,
      status: env.STARTUP_STRICT_STORAGE ? "failed" : "degraded",
      lastError: toStorageErrorMessage(error),
    };
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
  authSecurityStore,
  authLoginRateLimitMaxAttempts: env.AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  authLoginRateLimitWindowSeconds: env.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  authLoginLockoutThreshold: env.AUTH_LOGIN_LOCKOUT_THRESHOLD,
  authLoginLockoutSeconds: env.AUTH_LOGIN_LOCKOUT_SECONDS,
  passwordResetTokenRepository:
    container.repositories.passwordResetTokenRepository,
  emailChangeTokenRepository: container.repositories.emailChangeTokenRepository,
  invitationRepository: container.repositories.invitationRepository,
  invitationEmailSender: container.auth.invitationEmailSender,
  emailChangeVerificationEmailSender:
    container.auth.emailChangeVerificationEmailSender,
  passwordResetEmailSender: container.auth.passwordResetEmailSender,
  inviteTokenTtlSeconds: env.INVITE_TOKEN_TTL_SECONDS,
  inviteAcceptBaseUrl: env.INVITE_ACCEPT_BASE_URL,
  resetPasswordBaseUrl: env.RESET_PASSWORD_BASE_URL,
  emailChangeTokenTtlSeconds: env.EMAIL_CHANGE_TOKEN_TTL_SECONDS,
  emailChangeVerifyBaseUrl: env.EMAIL_CHANGE_VERIFY_BASE_URL,
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
  repositories: {
    playlistRepository: container.repositories.playlistRepository,
    contentRepository: container.repositories.contentRepository,
    userRepository: container.repositories.userRepository,
    authorizationRepository: container.repositories.authorizationRepository,
    scheduleRepository: container.repositories.scheduleRepository,
    displayRepository: container.repositories.displayRepository,
  },
});

const schedulesRouter = createSchedulesRouter({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  repositories: {
    scheduleRepository: container.repositories.scheduleRepository,
    playlistRepository: container.repositories.playlistRepository,
    displayRepository: container.repositories.displayRepository,
    contentRepository: container.repositories.contentRepository,
    authorizationRepository: container.repositories.authorizationRepository,
  },
});

const displaysRouter = createDisplaysRouter({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  downloadUrlExpiresInSeconds: 60 * 60,
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
  },
  storage: container.storage.contentStorage,
});

const displayRouter = createDisplayRouter({
  jwtSecret: env.JWT_SECRET,
  downloadUrlExpiresInSeconds: 60 * 60,
  scheduleTimeZone: env.SCHEDULE_TIMEZONE,
  authSecurityStore,
  rateLimits: {
    windowSeconds: env.DISPLAY_RUNTIME_RATE_LIMIT_WINDOW_SECONDS,
    authChallengeMaxAttempts: env.DISPLAY_RUNTIME_AUTH_CHALLENGE_MAX_ATTEMPTS,
    authVerifyMaxAttempts: env.DISPLAY_RUNTIME_AUTH_VERIFY_MAX_ATTEMPTS,
  },
  repositories: {
    displayRepository: container.repositories.displayRepository,
    scheduleRepository: container.repositories.scheduleRepository,
    playlistRepository: container.repositories.playlistRepository,
    contentRepository: container.repositories.contentRepository,
    runtimeControlRepository: container.repositories.runtimeControlRepository,
    displayKeyRepository: container.repositories.displayKeyRepository,
    displayAuthNonceRepository:
      container.repositories.displayAuthNonceRepository,
  },
  storage: container.storage.contentStorage,
  defaultEmergencyContentId: env.DEFAULT_EMERGENCY_CONTENT_ID,
});

const contentRouter = createContentRouter({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  maxUploadBytes: env.CONTENT_MAX_UPLOAD_BYTES,
  downloadUrlExpiresInSeconds: 60 * 60,
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
});

const contentJobsRouter = createContentJobsRouter({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
  maxUploadBytes: env.CONTENT_MAX_UPLOAD_BYTES,
  downloadUrlExpiresInSeconds: 60 * 60,
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
});

const rbacRouter = createRbacRouter({
  jwtSecret: env.JWT_SECRET,
  authSessionRepository: container.repositories.authSessionRepository,
  authSessionCookieName: env.AUTH_SESSION_COOKIE_NAME,
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

const auditRouter = createAuditRouter({
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

const auditQueue = new RedisAuditQueue({
  enabled: env.AUDIT_QUEUE_ENABLED,
  maxStreamLength: env.AUDIT_QUEUE_CAPACITY,
  streamName: env.REDIS_STREAM_AUDIT_NAME,
});

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

const getVar = <T = unknown>(
  c: { get: (name: string) => T | undefined },
  key: string,
): T | undefined => {
  return (c as { get: (name: string) => T | undefined }).get(key);
};

const parseIntHeader = (value: unknown): number | undefined => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const isAuthCommandRoute = (path: string) =>
  /^\/api\/v1\/auth\/(?:login|session|password|password-reset|forgot|invitations\/accept)\b/.test(
    path,
  );

app.use("*", async (c, next) => {
  const originalJson = c.json.bind(c) as (
    body: unknown,
    ...rest: unknown[]
  ) => Response;
  const getContextVar = <T = unknown>(key: string): T | undefined =>
    getVar<T>(c, key);
  const getJsonStatus = (init: unknown): number => {
    if (typeof init === "number") {
      return init;
    }
    if (init != null && typeof init === "object" && "status" in init) {
      const status = (init as { status?: unknown }).status;
      return typeof status === "number" ? status : 200;
    }
    return 200;
  };
  (c as { json: typeof originalJson }).json = ((
    value: unknown,
    init,
    headers,
  ) => {
    const normalized = normalizeApiPayload(value, {
      requestUrl: c.req.url,
    });
    const status = getJsonStatus(init);

    if (status === 429) {
      const limit =
        parseIntHeader(getContextVar<string>("rateLimitLimit")) ?? 100;
      const remaining =
        parseIntHeader(getContextVar<string>("rateLimitRemaining")) ?? 0;
      const reset = parseIntHeader(getContextVar<string>("rateLimitReset"));
      const retryAfter =
        parseIntHeader(getContextVar<string>("rateLimitRetryAfter")) ?? 60;
      c.header("X-RateLimit-Limit", String(limit));
      c.header("X-RateLimit-Remaining", String(Math.max(0, remaining)));
      if (reset != null) {
        c.header("X-RateLimit-Reset", String(reset));
      }
      c.header("Retry-After", String(retryAfter));
    }

    if (
      status === 201 &&
      !isAuthCommandRoute(c.req.path) &&
      value != null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.hasOwn(value, "id")
    ) {
      const id = (value as { id: unknown }).id;
      if (typeof id === "string" && id.length > 0) {
        c.header("Location", `${c.req.path}/${encodeURIComponent(id)}`);
      }
    }

    return originalJson(normalized, init as unknown, headers as unknown);
  }) as typeof originalJson;
  await next();
});

app.route("/api/v1/health", healthRouter);
app.route("/api/v1/auth", authRouter);
app.route("/api/v1/playlists", playlistsRouter);
app.route("/api/v1/schedules", schedulesRouter);
app.route("/api/v1/displays", displaysRouter);
app.route("/api/v1/display-runtime", displayRouter);
app.route("/api/v1/content", contentRouter);
app.route("/api/v1/content-jobs", contentJobsRouter);
app.route("/api/v1/audit", auditRouter);
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
