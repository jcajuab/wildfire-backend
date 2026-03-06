import { describe, expect, test } from "bun:test";
import { type ContentRecord } from "#/application/ports/content";
import { sha256Hex } from "#/domain/content/checksum";
import { DEMO_CONTENT } from "../../../../scripts/seed/fixtures";
import { type SeedContext } from "../../../../scripts/seed/stage-types";
import { runSeedDemoContent } from "../../../../scripts/seed/stages/seed-demo-content";

const toArrayBuffer = (value: Uint8Array): ArrayBuffer =>
  Uint8Array.from(value).buffer;

describe("runSeedDemoContent", () => {
  test("is idempotent when demo content is already up to date", async () => {
    const records = new Map<string, ContentRecord>();
    const uploads: string[] = [];
    const createdIds: string[] = [];
    const updatedIds: string[] = [];

    for (const fixture of DEMO_CONTENT) {
      const checksum = await sha256Hex(toArrayBuffer(fixture.body));
      records.set(fixture.id, {
        id: fixture.id,
        title: fixture.title,
        type: fixture.type,
        kind: fixture.kind,
        status: "READY",
        fileKey: fixture.fileKey,
        thumbnailKey: null,
        parentContentId: fixture.parentContentId,
        pageNumber: fixture.pageNumber,
        pageCount: fixture.pageCount,
        isExcluded: fixture.isExcluded,
        checksum,
        mimeType: fixture.mimeType,
        fileSize: fixture.body.byteLength,
        width: fixture.width,
        height: fixture.height,
        duration: fixture.duration,
        createdById: "demo-content-user-id",
        createdAt: "2024-01-01T00:00:00.000Z",
      });
    }

    const ctx = {
      args: { dryRun: false },
      repos: {
        userRepository: {
          findByUsername: async () => ({
            id: "demo-content-user-id",
            username: "demo.content",
            email: "demo.content@demo.local",
            name: "Demo Content",
            isActive: true,
          }),
        },
        contentRepository: {
          create: async (record: ContentRecord) => {
            createdIds.push(record.id);
            records.set(record.id, record);
            return record;
          },
          findById: async (id: string) => records.get(id) ?? null,
          findByIds: async () => [],
          list: async () => ({
            items: [],
            total: 0,
          }),
          findChildrenByParentIds: async () => [],
          countPlaylistReferences: async () => 0,
          listPlaylistsReferencingContent: async () => [],
          deleteByParentId: async () => [],
          update: async (_id: string, input: Partial<ContentRecord>) => {
            const existing = records.get(_id);
            if (!existing) {
              return null;
            }
            const next = { ...existing, ...input };
            records.set(_id, next);
            updatedIds.push(_id);
            return next;
          },
          delete: async () => false,
        },
        contentIngestionJobRepository:
          {} as SeedContext["repos"]["contentIngestionJobRepository"],
        permissionRepository:
          {} as SeedContext["repos"]["permissionRepository"],
        roleRepository: {} as SeedContext["repos"]["roleRepository"],
        rolePermissionRepository:
          {} as SeedContext["repos"]["rolePermissionRepository"],
        userRoleRepository: {} as SeedContext["repos"]["userRoleRepository"],
        displayRepository: {} as SeedContext["repos"]["displayRepository"],
        displayGroupRepository:
          {} as SeedContext["repos"]["displayGroupRepository"],
        playlistRepository: {} as SeedContext["repos"]["playlistRepository"],
        scheduleRepository: {} as SeedContext["repos"]["scheduleRepository"],
        auditLogRepository: {} as SeedContext["repos"]["auditLogRepository"],
      },
      storage: {
        contentStorage: {
          upload: async ({ key }: { key: string }) => {
            uploads.push(key);
          },
          delete: async () => {},
          download: async () => new Uint8Array(),
          ensureBucketExists: async () => {},
          getPresignedDownloadUrl: async () => "",
        },
      },
      htshadowPath: "/tmp/seed",
      io: {
        readFile: async () => "",
        hashPassword: async (password: string) => password,
        writeFile: async () => {},
      },
    } as unknown as SeedContext;

    const first = await runSeedDemoContent(ctx);
    const second = await runSeedDemoContent(ctx);

    expect(first.created).toBe(0);
    expect(first.updated).toBe(0);
    expect(first.skipped).toBe(DEMO_CONTENT.length);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(DEMO_CONTENT.length);
    expect(uploads).toHaveLength(0);
    expect(createdIds).toHaveLength(0);
    expect(updatedIds).toHaveLength(0);
  });
});
