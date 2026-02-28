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
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    ROOT_USER: z.string().email(),
    ROOT_PASSWORD: z.string(),
    MYSQL_ROOT_PASSWORD: z.string(),
    MYSQL_HOST: z.string(),
    MYSQL_PORT: z.coerce.number().default(3306),
    MYSQL_DATABASE: z.string(),
    MYSQL_USER: z.string(),
    MYSQL_PASSWORD: z.string(),
    MINIO_ROOT_USER: z.string().default("minioadmin"),
    MINIO_ROOT_PASSWORD: z.string().default("minioadmin"),
    MINIO_ENDPOINT: z.string().default("localhost"),
    MINIO_PORT: z.coerce.number().default(9000),
    MINIO_CONSOLE_PORT: z.coerce.number().default(9001),
    MINIO_USE_SSL: z.string().default("false").pipe(z.stringbool()),
    MINIO_BUCKET: z.string().default("content"),
    MINIO_REGION: z.string().default("us-east-1"),
    MINIO_REQUEST_TIMEOUT_MS: z.coerce.number().default(15_000),
    CONTENT_MAX_UPLOAD_BYTES: z.coerce.number().default(100 * 1024 * 1024),
    HTSHADOW_PATH: z.string(),
    JWT_SECRET: z.string(),
    JWT_ISSUER: z.string().default("wildfire"),
    AUTH_SESSION_COOKIE_NAME: z.string().default("wildfire_session_token"),
    AUTH_SESSION_DUAL_MODE: z.string().default("true").pipe(z.stringbool()),
    AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().default(10),
    AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(60),
    AUTH_LOGIN_LOCKOUT_THRESHOLD: z.coerce.number().default(5),
    AUTH_LOGIN_LOCKOUT_SECONDS: z.coerce.number().default(300),
    INVITE_TOKEN_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24),
    INVITE_ACCEPT_BASE_URL: z
      .string()
      .default("http://localhost:3000/accept-invite"),
    RESET_PASSWORD_BASE_URL: z
      .string()
      .default("http://localhost:3000/reset-password"),
    LOG_LEVEL: z.string().default("info"),
    LOG_PRETTY: z.string().default("true").pipe(z.stringbool()),
    AUDIT_QUEUE_ENABLED: z.string().default("true").pipe(z.stringbool()),
    AUDIT_QUEUE_CAPACITY: z.coerce.number().default(5000),
    AUDIT_FLUSH_BATCH_SIZE: z.coerce.number().default(100),
    AUDIT_FLUSH_INTERVAL_MS: z.coerce.number().default(250),
    AUDIT_EXPORT_MAX_ROWS: z.coerce.number().default(100000),
    SCHEDULE_TIMEZONE: z.string().default("UTC"),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform(parseCorsOrigins),
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
