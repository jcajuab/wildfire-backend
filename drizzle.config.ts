import { defineConfig } from "drizzle-kit";
import { env } from "#/env";

const databaseUrl = `mysql://${encodeURIComponent(env.MYSQL_USER)}:${encodeURIComponent(
  env.MYSQL_PASSWORD,
)}@${env.MYSQL_HOST}:${env.MYSQL_PORT}/${env.MYSQL_DATABASE}`;

export default defineConfig({
  dialect: "mysql",
  schema: "./src/infrastructure/db/schema",
  casing: "snake_case",
  dbCredentials: {
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT,
    database: env.MYSQL_DATABASE,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    url: databaseUrl,
  },
});
