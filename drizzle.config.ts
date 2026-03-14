import { defineConfig } from "drizzle-kit";
import { DATABASE_URL, env } from "#/env";

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
    url: DATABASE_URL,
  },
});
