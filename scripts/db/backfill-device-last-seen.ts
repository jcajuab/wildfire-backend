import { sql } from "drizzle-orm";
import { db } from "#/infrastructure/db/client";

async function main(): Promise<void> {
  await db.execute(
    sql`UPDATE devices SET last_seen_at = updated_at WHERE last_seen_at IS NULL`,
  );
  console.log(
    "Backfilled devices.last_seen_at from updated_at where last_seen_at was NULL.",
  );
}

if (import.meta.main) {
  let exitCode = 0;
  try {
    await main();
  } catch (error) {
    exitCode = 1;
    console.error(error);
  }

  process.exit(exitCode);
}
