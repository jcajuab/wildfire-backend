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

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS displays (
      id varchar(36) PRIMARY KEY,
      name varchar(255) NOT NULL,
      slug varchar(255) NOT NULL,
      location varchar(255) NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS playlists (
      id varchar(36) PRIMARY KEY,
      name varchar(255) NOT NULL,
      description text NULL,
      owner_id varchar(36) NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS content (
      id varchar(36) PRIMARY KEY,
      title varchar(255) NOT NULL,
      type varchar(16) NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'PROCESSING',
      file_key varchar(512) NOT NULL,
      thumbnail_key varchar(512) NULL,
      checksum varchar(128) NOT NULL,
      mime_type varchar(120) NOT NULL,
      file_size int NOT NULL,
      width int NULL,
      height int NULL,
      duration int NULL,
      owner_id varchar(36) NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS playlist_items (
      id varchar(36) PRIMARY KEY,
      playlist_id varchar(36) NOT NULL,
      content_id varchar(36) NOT NULL,
      sequence int NOT NULL,
      duration int NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pairing_codes (
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
    CREATE TABLE IF NOT EXISTS schedules (
      id varchar(36) PRIMARY KEY,
      series_id varchar(36) NOT NULL,
      name varchar(255) NOT NULL,
      playlist_id varchar(36) NOT NULL,
      display_id varchar(36) NOT NULL,
      start_date varchar(10) NOT NULL DEFAULT '1970-01-01',
      end_date varchar(10) NOT NULL DEFAULT '2099-12-31',
      start_time varchar(5) NOT NULL,
      end_time varchar(5) NOT NULL,
      day_of_week int NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(sql`DELETE FROM schedules`);
  await db.execute(sql`DELETE FROM pairing_codes`);
  await db.execute(sql`DELETE FROM playlist_items`);
  await db.execute(sql`DELETE FROM playlists`);
  await db.execute(sql`DELETE FROM content`);
  await db.execute(sql`DELETE FROM displays`);

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
      INSERT INTO content (id, title, type, status, file_key, checksum, mime_type, file_size, owner_id)
      VALUES ('content-1', 'Welcome', 'IMAGE', 'READY', 'content/images/a.png', 'abc', 'image/png', 100, 'user-1')
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
