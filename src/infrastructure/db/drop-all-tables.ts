import { sql } from "drizzle-orm";
import { db } from "#/infrastructure/db/client";

async function main(): Promise<void> {
  // WARNING: This irreversibly drops all application tables in the current DB.
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);

  await db.execute(sql`DROP TABLE IF EXISTS user_roles`);
  console.log("Dropped table: user_roles");
  await db.execute(sql`DROP TABLE IF EXISTS role_permissions`);
  console.log("Dropped table: role_permissions");
  await db.execute(sql`DROP TABLE IF EXISTS playlist_items`);
  console.log("Dropped table: playlist_items");
  await db.execute(sql`DROP TABLE IF EXISTS schedules`);
  console.log("Dropped table: schedules");
  await db.execute(sql`DROP TABLE IF EXISTS content`);
  console.log("Dropped table: content");
  await db.execute(sql`DROP TABLE IF EXISTS playlists`);
  console.log("Dropped table: playlists");
  await db.execute(sql`DROP TABLE IF EXISTS devices`);
  console.log("Dropped table: devices");
  await db.execute(sql`DROP TABLE IF EXISTS users`);
  console.log("Dropped table: users");
  await db.execute(sql`DROP TABLE IF EXISTS roles`);
  console.log("Dropped table: roles");
  await db.execute(sql`DROP TABLE IF EXISTS permissions`);
  console.log("Dropped table: permissions");

  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
  console.log("Done. All tables dropped.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
