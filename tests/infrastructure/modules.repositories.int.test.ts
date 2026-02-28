import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { setTestEnv } from "../helpers/env";

const runIntegration = process.env.RUN_INTEGRATION === "true";
const maybeTest = runIntegration ? test : test.skip;

const setup = async () => {
  setTestEnv({
    MYSQL_HOST: process.env.MYSQL_HOST ?? "127.0.0.1",
    MYSQL_PORT: process.env.MYSQL_PORT ?? "3306",
    MYSQL_DATABASE: process.env.MYSQL_DATABASE ?? "wildfire_test",
    MYSQL_USER: process.env.MYSQL_USER ?? "wildfire",
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ?? "wildfire",
  });

  const { db } = await import("#/infrastructure/db/client");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS displays (
      id varchar(36) PRIMARY KEY,
      name varchar(255) NOT NULL,
      identifier varchar(255) NOT NULL,
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
      created_by_id varchar(36) NOT NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS content (
      id varchar(36) PRIMARY KEY,
      title varchar(255) NOT NULL,
      type varchar(16) NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'DRAFT',
      file_key varchar(512) NOT NULL,
      thumbnail_key varchar(512) NULL,
      checksum varchar(128) NOT NULL,
      mime_type varchar(120) NOT NULL,
      file_size int NOT NULL,
      width int NULL,
      height int NULL,
      duration int NULL,
      created_by_id varchar(36) NOT NULL,
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
      created_by_id varchar(36) NOT NULL,
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
      priority int NOT NULL,
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
      identifier: "AA:BB",
      location: null,
    });

    const found = await repo.findByIdentifier("AA:BB");
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
      INSERT INTO content (id, title, type, status, file_key, checksum, mime_type, file_size, created_by_id)
      VALUES ('content-1', 'Welcome', 'IMAGE', 'DRAFT', 'content/images/a.png', 'abc', 'image/png', 100, 'user-1')
    `);

    const repo = new PlaylistDbRepository();
    const playlist = await repo.create({
      name: "Morning",
      description: null,
      createdById: "user-1",
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
    await setup();
    const { ScheduleDbRepository } = await import(
      "#/infrastructure/db/repositories/schedule.repo"
    );

    const scheduleRepo = new ScheduleDbRepository();
    const created = await scheduleRepo.create({
      seriesId: "series-1",
      name: "Morning",
      playlistId: "playlist-1",
      displayId: "display-1",
      startTime: "08:00",
      endTime: "17:00",
      dayOfWeek: 1,
      priority: 10,
      isActive: true,
    });

    expect(created.id).toBeDefined();
  });

  maybeTest(
    "DisplayPairingCodeDbRepository consumes valid code once",
    async () => {
      await setup();
      const { DisplayPairingCodeDbRepository } = await import(
        "#/infrastructure/db/repositories/display-pairing-code.repo"
      );

      const repo = new DisplayPairingCodeDbRepository();
      const created = await repo.create({
        codeHash: "hash-1",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdById: "user-1",
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
