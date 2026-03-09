import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { setTestEnv } from "../helpers/env";
import {
  getIntegrationMySqlEnv,
  isRunIntegrationEnabled,
} from "../helpers/integration-env";

const runIntegration = isRunIntegrationEnabled();
const maybeTest = runIntegration ? test : test.skip;

describe("ContentDbRepository (integration)", () => {
  maybeTest("creates, lists, and deletes content records", async () => {
    setTestEnv(getIntegrationMySqlEnv());

    const { db } = await import("#/infrastructure/db/client");
    const { ContentDbRepository } = await import(
      "#/infrastructure/db/repositories/content.repo"
    );

    await db.execute(
      sql`
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
      `,
    );
    await db.execute(
      sql`
        INSERT INTO users (id, username, email, name, is_active)
        VALUES ('user-1', 'user-1', 'user-1@example.com', 'User 1', true)
        ON DUPLICATE KEY UPDATE id = id
      `,
    );
    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
    await db.execute(sql`DELETE FROM content`);
    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);

    const repo = new ContentDbRepository();
    const id = crypto.randomUUID();
    const created = await repo.create({
      id,
      title: "Poster",
      type: "IMAGE",
      status: "PROCESSING",
      fileKey: `content/images/${id}.png`,
      thumbnailKey: null,
      checksum: "abc123",
      mimeType: "image/png",
      fileSize: 123,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
    });

    expect(created.id).toBe(id);

    const found = await repo.findById(id);
    expect(found?.id).toBe(id);

    const list = await repo.list({ offset: 0, limit: 10 });
    expect(list.total).toBe(1);

    const updated = await repo.update(id, { title: "Updated Poster" });
    expect(updated?.title).toBe("Updated Poster");
    const metadataUpdated = await repo.update(id, {
      fileKey: `content/videos/${id}.mp4`,
      thumbnailKey: `content/thumbnails/${id}.jpg`,
      type: "VIDEO",
      mimeType: "video/mp4",
      fileSize: 456,
      width: 1920,
      height: 1080,
      duration: 30,
      checksum: "next-checksum",
    });
    expect(metadataUpdated?.fileKey).toBe(`content/videos/${id}.mp4`);
    expect(metadataUpdated?.thumbnailKey).toBe(`content/thumbnails/${id}.jpg`);
    expect(metadataUpdated?.type).toBe("VIDEO");
    expect(metadataUpdated?.mimeType).toBe("video/mp4");
    expect(metadataUpdated?.fileSize).toBe(456);
    expect(metadataUpdated?.width).toBe(1920);
    expect(metadataUpdated?.height).toBe(1080);
    expect(metadataUpdated?.duration).toBe(30);
    expect(metadataUpdated?.checksum).toBe("next-checksum");

    const notUpdated = await repo.update(crypto.randomUUID(), {
      title: "No-op",
    });
    expect(notUpdated).toBeNull();

    const deleted = await repo.delete(id);
    expect(deleted).toBe(true);
  });
});
