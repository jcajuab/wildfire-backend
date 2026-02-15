import { sql } from "drizzle-orm";
import { db } from "#/infrastructure/db/client";

const TABLES = [
  "audit_events",
  "user_roles",
  "role_permissions",
  "playlist_items",
  "schedules",
  "content",
  "playlists",
  "devices",
  "users",
  "roles",
  "permissions",
] as const;

export const parseDropArgs = (argv: string[]) => {
  const force = argv.includes("--force");
  const unknownFlags = argv.filter(
    (arg) => arg.startsWith("--") && arg !== "--force",
  );

  if (unknownFlags.length > 0) {
    throw new Error(`Unknown flag(s): ${unknownFlags.join(", ")}`);
  }

  return { force };
};

async function main(): Promise<void> {
  const args = parseDropArgs(process.argv.slice(2));
  if (!args.force) {
    console.error(
      "Refusing to drop tables without --force. Example: bun run db:drop -- --force",
    );
    process.exit(2);
  }

  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);

  for (const table of TABLES) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${table}`));
    console.log(`Dropped table: ${table}`);
  }

  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
  console.log("Done. All tables dropped.");
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
