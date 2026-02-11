import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.string(),
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
    MINIO_USE_SSL: z.string().optional().default("false").pipe(z.stringbool()),
    MINIO_BUCKET: z.string().default("content"),
    MINIO_REGION: z.string().default("us-east-1"),
    MINIO_REQUEST_TIMEOUT_MS: z.coerce.number().default(15_000),
    CONTENT_MAX_UPLOAD_BYTES: z.coerce.number().default(100 * 1024 * 1024),
    HTSHADOW_PATH: z.string().default("/etc/htshadow"),
    JWT_SECRET: z.string(),
    JWT_ISSUER: z.string().optional(),
    LOG_LEVEL: z.string().default("info"),
    LOG_PRETTY: z.string().optional().default("true").pipe(z.stringbool()),
    SCHEDULE_TIMEZONE: z.string().default("UTC"),
    DEVICE_API_KEY: z.string().min(1),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((val) => val.split(",")),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
