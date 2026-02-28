import { sql } from "drizzle-orm";
import { db } from "#/infrastructure/db/client";

const TABLES = [
  "audit_events",
  "auth_sessions",
  "content",
  "display_group_memberships",
  "display_groups",
  "displays",
  "display_keys",
  "display_pairing_sessions",
  "display_auth_nonces",
  "display_state_transitions",
  "invitations",
  "password_reset_tokens",
  "permissions",
  "playlist_items",
  "playlists",
  "role_permissions",
  "policy_history",
  "pairing_codes",
  "role_deletion_requests",
  "roles",
  "schedules",
  "system_settings",
  "user_roles",
  "users",
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
    await db.execute(sql.raw(`DROP TABLE IF EXISTS \`${table}\``));
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
