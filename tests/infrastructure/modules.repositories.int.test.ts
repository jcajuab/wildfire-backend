import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { setTestEnv } from "../helpers/env";
import {
  getIntegrationMySqlEnv,
  isRunIntegrationEnabled,
} from "../helpers/integration-env";

const runIntegration = isRunIntegrationEnabled();
const maybeTest = runIntegration ? test : test.skip;

const setup = async () => {
  setTestEnv(getIntegrationMySqlEnv());

  const { db } = await import("#/infrastructure/db/client");

  // Drop any stale tables from prior migrations/runs so the hand-rolled test
  // DDL below is always authoritative. Without this, CREATE TABLE IF NOT
  // EXISTS silently skips when an older schema is present, producing "Unknown
  // column" errors at insert time. FK checks are disabled for the drop
  // because migrations may have created child tables with FK constraints
  // pointing at the ones we want to recreate.
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  await db.execute(sql`DROP TABLE IF EXISTS schedules`);
  await db.execute(sql`DROP TABLE IF EXISTS pairing_codes`);
  await db.execute(sql`DROP TABLE IF EXISTS playlist_items`);
  await db.execute(sql`DROP TABLE IF EXISTS playlists`);
  await db.execute(sql`DROP TABLE IF EXISTS content_assets`);
  await db.execute(sql`DROP TABLE IF EXISTS content`);
  await db.execute(sql`DROP TABLE IF EXISTS displays`);
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);

  await db.execute(sql`
    CREATE TABLE displays (
      id varchar(36) PRIMARY KEY,
      name varchar(255) NOT NULL,
      slug varchar(255) NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'READY',
      output varchar(16) NOT NULL DEFAULT 'unknown',
      location varchar(255) NULL,
      fingerprint varchar(255) NULL,
      ip_address varchar(64) NULL,
      mac_address varchar(64) NULL,
      screen_width int NULL,
      screen_height int NULL,
      orientation varchar(16) NULL,
      emergency_content_id varchar(36) NULL,
      last_seen_at timestamp NULL,
      refresh_nonce int NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(sql`
    CREATE TABLE playlists (
      id varchar(36) PRIMARY KEY,
      name varchar(255) NOT NULL,
      description text NULL,
      status varchar(16) NOT NULL DEFAULT 'DRAFT',
      owner_id varchar(36) NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(sql`
    CREATE TABLE content (
      id varchar(36) PRIMARY KEY,
      title varchar(255) NOT NULL,
      type varchar(16) NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'PROCESSING',
      owner_id varchar(36) NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(sql`
    CREATE TABLE content_assets (
      content_id varchar(36) PRIMARY KEY,
      file_key varchar(512) NOT NULL,
      thumbnail_key varchar(512) NULL,
      checksum varchar(128) NOT NULL,
      mime_type varchar(120) NOT NULL,
      file_size int NOT NULL,
      width int NULL,
      height int NULL,
      duration int NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(sql`
    CREATE TABLE playlist_items (
      id varchar(36) PRIMARY KEY,
      playlist_id varchar(36) NOT NULL,
      content_id varchar(36) NOT NULL,
      sequence int NOT NULL,
      duration int NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE pairing_codes (
      id varchar(36) PRIMARY KEY,
      code_hash varchar(64) NOT NULL,
      expires_at timestamp NOT NULL,
      used_at timestamp NULL,
      owner_id varchar(36) NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY pairing_codes_code_hash_unique (code_hash)
    )
  `);
  await db.execute(sql`
    CREATE TABLE schedules (
      id varchar(36) PRIMARY KEY,
      series_id varchar(36) NULL,
      name varchar(255) NOT NULL,
      playlist_id varchar(36) NULL,
      display_id varchar(36) NOT NULL,
      start_date varchar(10) NOT NULL DEFAULT '1970-01-01',
      end_date varchar(10) NOT NULL DEFAULT '2099-12-31',
      start_time varchar(5) NOT NULL,
      end_time varchar(5) NOT NULL,
      day_of_week int NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_by varchar(36) NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  return { db };
};

describe("Module repositories (integration)", () => {
  maybeTest("DisplayDbRepository CRUD", async () => {
    await setup();
    const { DisplayDbRepository } = await import(
      "#/infrastructure/db/repositories/display.repo"
    );

    const repo = new DisplayDbRepository();
    const created = await repo.create({
      name: "Lobby",
      slug: "AA:BB",
      location: null,
    });

    const found = await repo.findBySlug("AA:BB");
    expect(found?.id).toBe(created.id);

    const list = await repo.list();
    expect(list.length).toBe(1);

    const updated = await repo.update(created.id, {
      name: "Lobby Updated",
      location: "Main Hall",
    });
    expect(updated?.name).toBe("Lobby Updated");
    expect(updated?.location).toBe("Main Hall");
  });

  maybeTest("PlaylistDbRepository creates playlist items", async () => {
    const { db } = await setup();
    const { PlaylistDbRepository } = await import(
      "#/infrastructure/db/repositories/playlist.repo"
    );

    await db.execute(sql`
      INSERT INTO users (id, username, email, name, is_active)
      VALUES ('user-1', 'user-1', 'user-1@example.com', 'User 1', true)
      ON DUPLICATE KEY UPDATE id = id
    `);
    await db.execute(sql`
      INSERT INTO content (id, title, type, status, owner_id)
      VALUES ('content-1', 'Welcome', 'IMAGE', 'READY', 'user-1')
    `);
    await db.execute(sql`
      INSERT INTO content_assets (content_id, file_key, checksum, mime_type, file_size)
      VALUES ('content-1', 'content/images/a.png', 'abc', 'image/png', 100)
    `);

    const repo = new PlaylistDbRepository();
    const playlist = await repo.create({
      name: "Morning",
      description: null,
      ownerId: "user-1",
    });

    await repo.addItem({
      playlistId: playlist.id,
      contentId: "content-1",
      sequence: 10,
      duration: 5,
    });

    const items = await repo.listItems(playlist.id);
    expect(items).toHaveLength(1);
  });

  maybeTest("ScheduleDbRepository creates schedule", async () => {
    const { db } = await setup();
    const { ScheduleDbRepository } = await import(
      "#/infrastructure/db/repositories/schedule.repo"
    );

    await db.execute(sql`
      INSERT INTO users (id, username, email, name, is_active)
      VALUES ('user-1', 'user-1', 'user-1@example.com', 'User 1', true)
      ON DUPLICATE KEY UPDATE id = id
    `);
    await db.execute(sql`
      INSERT INTO displays (id, slug, name, status, output)
      VALUES ('display-1', 'display-1', 'Display 1', 'READY', 'unknown')
      ON DUPLICATE KEY UPDATE id = id
    `);
    await db.execute(sql`
      INSERT INTO playlists (id, name, description, status, owner_id)
      VALUES ('playlist-1', 'Playlist 1', NULL, 'DRAFT', 'user-1')
      ON DUPLICATE KEY UPDATE id = id
    `);

    const scheduleRepo = new ScheduleDbRepository();
    const created = await scheduleRepo.create({
      name: "Morning",
      kind: "PLAYLIST",
      playlistId: "playlist-1",
      contentId: null,
      displayId: "display-1",
      createdBy: "user-1",
      startTime: "08:00",
      endTime: "17:00",
    });

    expect(created.id).toBeDefined();
  });

  maybeTest(
    "DisplayPairingCodeRedisRepository consumes valid code once",
    async () => {
      await setup();
      const { DisplayPairingCodeRedisRepository } = await import(
        "#/infrastructure/db/repositories/display-pairing-code.repo"
      );

      const repo = new DisplayPairingCodeRedisRepository();
      const created = await repo.create({
        codeHash: "hash-1",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        ownerId: "user-1",
      });
      expect(created.id).toBeDefined();

      const consumed = await repo.consumeValidCode({
        codeHash: "hash-1",
        now: new Date(),
      });
      expect(consumed).not.toBeNull();

      const secondConsume = await repo.consumeValidCode({
        codeHash: "hash-1",
        now: new Date(),
      });
      expect(secondConsume).toBeNull();
    },
  );
});
