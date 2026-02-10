import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";
import { env } from "#/env";

const pool = createPool(env.DATABASE_URL);

export const db = drizzle(pool, { casing: "snake_case" });

export async function closeDbConnection(): Promise<void> {
  await pool.end();
}
