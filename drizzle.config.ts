import { defineConfig } from "drizzle-kit";

const host = process.env.MYSQL_HOST ?? "localhost";
const port = Number(process.env.MYSQL_PORT ?? 3306);
const user = process.env.MYSQL_USER ?? "";
const password = process.env.MYSQL_PASSWORD ?? "";
const database = process.env.MYSQL_DATABASE ?? "";

export default defineConfig({
  dialect: "mysql",
  schema: "./src/infrastructure/db/schema/*.sql.ts",
  casing: "snake_case",
  dbCredentials: {
    host,
    port,
    database,
    user,
    password,
    url: `mysql://${user}:${password}@${host}:${port}/${database}`,
  },
});
