import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";
import { env } from "#/env";
import { withTimeout } from "#/shared/retry";

const pool = createPool({
  host: env.MYSQL_HOST,
  port: env.MYSQL_PORT,
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.MYSQL_DATABASE,
  connectionLimit: Math.max(1, Math.trunc(env.MYSQL_POOL_CONNECTION_LIMIT)),
  queueLimit: Math.max(0, Math.trunc(env.MYSQL_POOL_QUEUE_LIMIT)),
  waitForConnections: env.MYSQL_POOL_WAIT_FOR_CONNECTIONS,
  connectTimeout: Math.max(1, Math.trunc(env.MYSQL_CONNECT_TIMEOUT_MS)),
  idleTimeout: Math.max(0, Math.trunc(env.MYSQL_POOL_IDLE_TIMEOUT_MS)),
  maxIdle: Math.max(0, Math.trunc(env.MYSQL_POOL_MAX_IDLE)),
});

export const db = drizzle({ client: pool, casing: "snake_case" });

type DbConnectivityConnection = {
  release: () => void;
  destroy: () => void;
  query: (input: { sql: string; timeout?: number }) => Promise<unknown>;
};

export const checkDbConnectivity = async (): Promise<void> => {
  const timeoutMs = Math.max(1, Math.trunc(env.HEALTH_CHECK_TIMEOUT_MS));

  await withTimeout(
    async (signal) => {
      const connection = await withTimeout<DbConnectivityConnection>(
        pool.getConnection() as Promise<DbConnectivityConnection>,
        timeoutMs,
        "mysql getConnection",
      );

      const abortQuery = (): void => {
        try {
          connection.destroy();
        } catch {
          // Ignore any destroy-time cleanup failures to avoid masking root causes.
        }
      };

      signal.addEventListener("abort", abortQuery, { once: true });

      try {
        await withTimeout(
          connection.query({
            sql: "SELECT 1",
            timeout: timeoutMs,
          }),
          timeoutMs,
          "mysql SELECT 1",
        );
      } finally {
        signal.removeEventListener("abort", abortQuery);
      }

      try {
        connection.release();
      } catch (_error) {
        connection.destroy();
      }
    },
    timeoutMs,
    "mysql connectivity check",
  );
};

export async function closeDbConnection(): Promise<void> {
  await pool.end();
}
