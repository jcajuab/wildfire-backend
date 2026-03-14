import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const parseCorsOrigins = (value: string): string[] =>
  value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

const buildDatabaseUrl = ({
  host,
  port,
  database,
  user,
  password,
}: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): string =>
  `mysql://${encodeURIComponent(user)}:${encodeURIComponent(
    password,
  )}@${host}:${port}/${database}`;

export const env = createEnv({
  server: {
    // Server
    PORT: z.coerce.number().default(8000),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    IDLE_TIMEOUT_MS: z.coerce.number().nonnegative().default(0),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform(parseCorsOrigins),
    TRUST_PROXY_HEADERS: z.string().default("true").pipe(z.stringbool()),

    // Admin identity
    ADMIN_USERNAME: z.string().min(1),
    ADMIN_EMAIL: z.string().email().optional(),
    ADMIN_PASSWORD: z.string(),

    // MySQL
    MYSQL_HOST: z.string(),
    MYSQL_PORT: z.coerce.number().default(3306),
    MYSQL_DATABASE: z.string(),
    MYSQL_USER: z.string(),
    MYSQL_PASSWORD: z.string(),
    MYSQL_CONNECT_TIMEOUT_MS: z.coerce.number().default(10_000),
    MYSQL_POOL_CONNECTION_LIMIT: z.coerce.number().default(10),
    MYSQL_POOL_QUEUE_LIMIT: z.coerce.number().default(0),
    MYSQL_POOL_WAIT_FOR_CONNECTIONS: z
      .string()
      .default("true")
      .pipe(z.stringbool()),
    MYSQL_POOL_IDLE_TIMEOUT_MS: z.coerce.number().default(60_000),
    MYSQL_POOL_MAX_IDLE: z.coerce.number().default(10_000),

    // MinIO / S3 storage
    MINIO_ROOT_USER: z.string().min(1),
    MINIO_ROOT_PASSWORD: z.string().min(1),
    MINIO_ENDPOINT: z.string().min(1),
    MINIO_PORT: z.coerce.number().default(9000),
    MINIO_USE_SSL: z.string().default("false").pipe(z.stringbool()),
    MINIO_BUCKET: z.string().min(1),
    MINIO_REGION: z.string().default("us-east-1"),
    MINIO_REQUEST_TIMEOUT_MS: z.coerce.number().default(15_000),
    STARTUP_STRICT_STORAGE: z.string().default("false").pipe(z.stringbool()),

    // Redis
    REDIS_URL: z.string().default("redis://localhost:6379"),
    REDIS_KEY_PREFIX: z.string().default("wf"),
    REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().default(10_000),
    // Applied to command, publisher, and subscriber Redis connections.
    // Set to 0 to disable socket timeouts (useful for long-lived subscribers).
    REDIS_SOCKET_TIMEOUT_MS: z.coerce.number().default(0),
    REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().default(5_000),
    REDIS_RETRY_MAX_ATTEMPTS: z.coerce.number().default(20),
    REDIS_RETRY_BASE_DELAY_MS: z.coerce.number().default(100),
    REDIS_RETRY_MAX_DELAY_MS: z.coerce.number().default(30_000),

    // Redis streams
    REDIS_STREAM_AUDIT_NAME: z.string().default("wf:stream:audit"),
    REDIS_STREAM_AUDIT_GROUP: z.string().default("wf-audit-writers"),
    REDIS_STREAM_CONTENT_INGEST_NAME: z
      .string()
      .default("wf:stream:content-ingestion"),
    REDIS_STREAM_CONTENT_INGEST_GROUP: z
      .string()
      .default("wf-content-ingestion-workers"),
    REDIS_STREAM_BLOCK_MS: z.coerce.number().default(5_000),
    REDIS_STREAM_BATCH_SIZE: z.coerce.number().default(100),
    REDIS_STREAM_MAX_DELIVERIES: z.coerce.number().default(5),

    // Worker retry
    WORKER_RETRY_BASE_DELAY_MS: z.coerce.number().default(250),
    WORKER_RETRY_MAX_DELAY_MS: z.coerce.number().default(5_000),

    // Auth & JWT
    HTSHADOW_PATH: z.string(),
    JWT_SECRET: z.string(),
    JWT_ISSUER: z.string().default("wildfire"),
    AUTH_SESSION_COOKIE_NAME: z.string().default("wildfire_session_token"),
    AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().default(10),
    AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(60),
    AUTH_LOGIN_LOCKOUT_THRESHOLD: z.coerce.number().default(5),
    AUTH_LOGIN_LOCKOUT_SECONDS: z.coerce.number().default(300),

    // Invitations
    INVITE_TOKEN_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24),
    INVITE_ACCEPT_BASE_URL: z
      .string()
      .default("http://localhost:3000/accept-invite"),
    EMAIL_CHANGE_TOKEN_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24),

    // Content
    CONTENT_MAX_UPLOAD_BYTES: z.coerce.number().default(100 * 1024 * 1024),
    VIDEO_MAX_UPLOAD_BYTES: z.coerce.number().default(10 * 1024 * 1024),
    CONTENT_INGEST_QUEUE_CAPACITY: z.coerce.number().default(5000),
    CONTENT_INGEST_QUEUE_ENQUEUE_MAX_ATTEMPTS: z.coerce.number().default(3),
    CONTENT_INGEST_QUEUE_ENQUEUE_BASE_DELAY_MS: z.coerce.number().default(250),
    CONTENT_INGEST_QUEUE_ENQUEUE_MAX_DELAY_MS: z.coerce.number().default(4_000),
    CONTENT_INGEST_QUEUE_ENQUEUE_TIMEOUT_MS: z.coerce.number().default(5_000),
    PRESIGNED_URL_TTL_SECONDS: z.coerce.number().default(3600),

    // Audit queue
    AUDIT_QUEUE_ENABLED: z.string().default("true").pipe(z.stringbool()),
    AUDIT_QUEUE_CAPACITY: z.coerce.number().default(5000),
    AUDIT_EXPORT_MAX_ROWS: z.coerce.number().default(100000),
    AUDIT_QUEUE_ENQUEUE_MAX_ATTEMPTS: z.coerce.number().default(3),
    AUDIT_QUEUE_ENQUEUE_BASE_DELAY_MS: z.coerce.number().default(250),
    AUDIT_QUEUE_ENQUEUE_MAX_DELAY_MS: z.coerce.number().default(2_000),
    AUDIT_QUEUE_ENQUEUE_TIMEOUT_MS: z.coerce.number().default(5_000),

    // Displays & runtime
    DEFAULT_EMERGENCY_CONTENT_ID: z.string().uuid().optional(),
    SCHEDULE_TIMEZONE: z.string().min(1),
    DISPLAY_RUNTIME_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(60),
    DISPLAY_RUNTIME_AUTH_CHALLENGE_MAX_ATTEMPTS: z.coerce.number().default(60),
    DISPLAY_RUNTIME_AUTH_VERIFY_MAX_ATTEMPTS: z.coerce.number().default(60),

    // AI
    // 32-byte hex-encoded AES-256 key for encrypting stored AI API keys
    AI_ENCRYPTION_KEY: z
      .string()
      .length(64)
      .regex(/^[0-9a-fA-F]+$/, "Must be a 64-character hex string")
      .default(
        "0000000000000000000000000000000000000000000000000000000000000000",
      ),
    AI_ALLOWED_CORS_HEADERS: z.string().default("X-AI-Provider-Key"),
    AI_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(60),
    AI_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(20),

    // Observability
    LOG_LEVEL: z.string().default("info"),
    LOG_PRETTY: z.string().default("true").pipe(z.stringbool()),
    HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().default(1_000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export const DATABASE_URL = buildDatabaseUrl({
  host: env.MYSQL_HOST,
  port: env.MYSQL_PORT,
  database: env.MYSQL_DATABASE,
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
});
