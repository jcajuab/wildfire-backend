import { describe, expect, test } from "bun:test";
import {
  type ContentMetadataExtractor,
  type ContentRecord,
  type ContentRepository,
  type ContentStorage,
  type ContentThumbnailGenerator,
} from "#/application/ports/content";
import { type UserRepository } from "#/application/ports/rbac";
import {
  ContentStorageCleanupError,
  DeleteContentUseCase,
  GetContentDownloadUrlUseCase,
  GetContentUseCase,
  InvalidContentTypeError,
  ListContentUseCase,
  NotFoundError,
  UpdateContentUseCase,
  UploadContentUseCase,
} from "#/application/use-cases/content";
import { sha256Hex } from "#/domain/content/checksum";

const makeContentRepository = () => {
  const records: ContentRecord[] = [];

  const repository: ContentRepository = {
    create: async (input) => {
      const record: ContentRecord = {
        ...input,
        createdAt: "2025-01-01T00:00:00.000Z",
      };
      records.push(record);
      return record;
    },
    findById: async (id) => records.find((item) => item.id === id) ?? null,
    findByIds: async (ids) => records.filter((item) => ids.includes(item.id)),
    list: async ({ offset, limit }) => ({
      items: records.slice(offset, offset + limit),
      total: records.length,
    }),
    countPlaylistReferences: async () => 0,
    delete: async (id) => {
      const index = records.findIndex((item) => item.id === id);
      if (index === -1) return false;
      records.splice(index, 1);
      return true;
    },
    update: async (id, input) => {
      const record = records.find((item) => item.id === id);
      if (!record) return null;
      Object.assign(record, input);
      return record;
    },
  };

  return { records, repository };
};

const makeUserRepository = (users: Array<{ id: string; name: string }>) =>
  ({
    list: async () =>
      users.map((user) => ({
        id: user.id,
        email: `${user.id}@example.com`,
        name: user.name,
        isActive: true,
      })),
    findById: async (id: string) => {
      const user = users.find((item) => item.id === id);
      if (!user) return null;
      return {
        id: user.id,
        email: `${user.id}@example.com`,
        name: user.name,
        isActive: true,
      };
    },
    findByIds: async (ids: string[]) =>
      users
        .filter((user) => ids.includes(user.id))
        .map((user) => ({
          id: user.id,
          email: `${user.id}@example.com`,
          name: user.name,
          isActive: true,
        })),
    findByEmail: async () => null,
    create: async () => {
      throw new Error("not needed in test");
    },
    update: async () => null,
    delete: async () => false,
  }) satisfies UserRepository;

const makeStorage = (options?: { deleteError?: Error }) => {
  type UploadInput = Parameters<ContentStorage["upload"]>[0];
  const uploads: UploadInput[] = [];
  const deletedKeys: string[] = [];

  const storage: ContentStorage = {
    upload: async (input) => {
      uploads.push(input);
    },
    delete: async (key) => {
      deletedKeys.push(key);
      if (options?.deleteError) {
        throw options.deleteError;
      }
    },
    getPresignedDownloadUrl: async ({ key }) => `https://example.com/${key}`,
  };

  return {
    storage,
    get uploads() {
      return uploads;
    },
    get deletedKeys() {
      return deletedKeys;
    },
    get lastUpload() {
      return uploads[uploads.length - 1] ?? null;
    },
    get lastDeletedKey() {
      return deletedKeys[deletedKeys.length - 1] ?? null;
    },
  };
};

const metadataExtractor: ContentMetadataExtractor = {
  extract: async ({ type }) => {
    if (type === "VIDEO") {
      return { width: 1920, height: 1080, duration: 30 };
    }
    return { width: 1366, height: 768, duration: null };
  },
};

const thumbnailGenerator: ContentThumbnailGenerator = {
  generate: async () => null,
};

describe("Content use cases", () => {
  test("uploads content and returns content view", async () => {
    const { repository } = makeContentRepository();
    const storage = makeStorage();
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const useCase = new UploadContentUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      contentMetadataExtractor: metadataExtractor,
      contentThumbnailGenerator: thumbnailGenerator,
      userRepository,
    });

    const file = new File([new TextEncoder().encode("hello")], "photo.png", {
      type: "image/png",
    });
    const checksum = await sha256Hex(await file.arrayBuffer());

    const result = await useCase.execute({
      title: "Welcome",
      file,
      createdById: "user-1",
    });

    expect(result.title).toBe("Welcome");
    expect(result.type).toBe("IMAGE");
    expect(result.status).toBe("DRAFT");
    expect(result.checksum).toBe(checksum);
    expect(result.createdBy).toEqual({ id: "user-1", name: "Ada" });
    expect(storage.lastUpload?.contentType).toBe("image/png");
    expect(storage.lastUpload?.key).toBe(`content/images/${result.id}.png`);
  });

  test("uploads generated thumbnail when available", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const useCase = new UploadContentUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      contentMetadataExtractor: metadataExtractor,
      contentThumbnailGenerator: {
        generate: async () => new Uint8Array([1, 2, 3]),
      },
      userRepository,
    });

    const file = new File([new TextEncoder().encode("hello")], "photo.png", {
      type: "image/png",
    });

    const result = await useCase.execute({
      title: "Welcome",
      file,
      createdById: "user-1",
    });

    expect(storage.uploads).toHaveLength(2);
    expect(storage.uploads[0]?.key).toBe(`content/images/${result.id}.png`);
    expect(storage.uploads[1]?.key).toBe(`content/thumbnails/${result.id}.jpg`);
    expect(storage.uploads[1]?.contentType).toBe("image/jpeg");
    expect(records[0]?.thumbnailKey).toBe(
      `content/thumbnails/${result.id}.jpg`,
    );
  });

  test("rejects unsupported file types", async () => {
    const { repository } = makeContentRepository();
    const storage = makeStorage();
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const useCase = new UploadContentUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      contentMetadataExtractor: metadataExtractor,
      contentThumbnailGenerator: thumbnailGenerator,
      userRepository,
    });

    const file = new File([new TextEncoder().encode("data")], "data.zip", {
      type: "application/zip",
    });

    await expect(
      useCase.execute({ title: "Invalid", file, createdById: "user-1" }),
    ).rejects.toBeInstanceOf(InvalidContentTypeError);
  });

  test("throws when creator does not exist", async () => {
    const { repository } = makeContentRepository();
    const storage = makeStorage();
    const userRepository = makeUserRepository([]);
    const useCase = new UploadContentUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      contentMetadataExtractor: metadataExtractor,
      contentThumbnailGenerator: thumbnailGenerator,
      userRepository,
    });

    const file = new File([new TextEncoder().encode("hello")], "photo.png", {
      type: "image/png",
    });

    await expect(
      useCase.execute({ title: "Missing user", file, createdById: "user-1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("lists content with pagination and creator names", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const userRepository = makeUserRepository([
      { id: "user-1", name: "Ada" },
      { id: "user-2", name: "Grace" },
    ]);
    records.push(
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "One",
        type: "IMAGE",
        status: "DRAFT",
        fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
        thumbnailKey:
          "content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
        checksum: "abc",
        mimeType: "image/png",
        fileSize: 10,
        width: null,
        height: null,
        duration: null,
        createdById: "user-1",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Two",
        type: "PDF",
        status: "DRAFT",
        fileKey: "content/documents/22222222-2222-4222-8222-222222222222.pdf",
        checksum: "def",
        mimeType: "application/pdf",
        fileSize: 20,
        width: null,
        height: null,
        duration: null,
        createdById: "user-2",
        createdAt: "2025-01-02T00:00:00.000Z",
      },
    );

    const useCase = new ListContentUseCase({
      contentRepository: repository,
      userRepository,
      contentStorage: storage.storage,
      thumbnailUrlExpiresInSeconds: 3600,
    });

    const result = await useCase.execute({ page: 1, pageSize: 1 });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.createdBy).toEqual({
      id: "user-1",
      name: "Ada",
    });
    expect(result.items[0]?.thumbnailUrl).toBe(
      "https://example.com/content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
    );
  });

  test("gets content by id", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const useCase = new GetContentUseCase({
      contentRepository: repository,
      userRepository,
      contentStorage: storage.storage,
      thumbnailUrlExpiresInSeconds: 3600,
    });

    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Poster",
      type: "IMAGE",
      status: "DRAFT",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      thumbnailKey:
        "content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const result = await useCase.execute({
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(result.createdBy.name).toBe("Ada");
    expect(result.thumbnailUrl).toBe(
      "https://example.com/content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
    );
  });

  test("throws when content is missing", async () => {
    const { repository } = makeContentRepository();
    const storage = makeStorage();
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const useCase = new GetContentUseCase({
      contentRepository: repository,
      userRepository,
      contentStorage: storage.storage,
      thumbnailUrlExpiresInSeconds: 3600,
    });

    await expect(useCase.execute({ id: "missing" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("deletes content and storage object", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const useCase = new DeleteContentUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      cleanupFailureLogger: {
        logContentCleanupFailure: () => undefined,
      },
    });

    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Poster",
      type: "IMAGE",
      status: "DRAFT",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    await useCase.execute({ id: "11111111-1111-4111-8111-111111111111" });
    expect(storage.lastDeletedKey).toBe(
      "content/images/11111111-1111-4111-8111-111111111111.png",
    );
  });

  test("deletes main file and thumbnail when both exist", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const useCase = new DeleteContentUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      cleanupFailureLogger: {
        logContentCleanupFailure: () => undefined,
      },
    });

    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Poster",
      type: "IMAGE",
      status: "DRAFT",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      thumbnailKey:
        "content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    await useCase.execute({ id: "11111111-1111-4111-8111-111111111111" });
    expect(storage.deletedKeys).toEqual([
      "content/images/11111111-1111-4111-8111-111111111111.png",
      "content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
    ]);
  });

  test("throws cleanup error when storage delete fails after metadata deletion", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage({
      deleteError: new Error("storage unavailable"),
    });
    const id = "11111111-1111-4111-8111-111111111111";
    records.push({
      id,
      title: "Poster",
      type: "IMAGE",
      status: "DRAFT",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const loggerCalls: unknown[] = [];
    const loggingUseCase = new DeleteContentUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      cleanupFailureLogger: {
        logContentCleanupFailure: (input) => {
          loggerCalls.push(input);
        },
      },
    });
    await expect(loggingUseCase.execute({ id })).rejects.toBeInstanceOf(
      ContentStorageCleanupError,
    );
    expect(await repository.findById(id)).toBeNull();
    expect(loggerCalls).toHaveLength(1);
    const payload = loggerCalls[0] as Record<string, unknown>;
    expect(payload.route).toBe("/content/:id");
    expect(payload.contentId).toBe(id);
    expect(payload.fileKey).toBe(
      "content/images/11111111-1111-4111-8111-111111111111.png",
    );
    expect(payload.failurePhase).toBe("delete_after_metadata_remove");
  });

  test("throws cleanup error when upload rollback delete fails", async () => {
    const storage = makeStorage({ deleteError: new Error("cleanup failed") });
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const loggerCalls: unknown[] = [];
    const useCase = new UploadContentUseCase({
      contentRepository: {
        create: async () => {
          throw new Error("db insert failed");
        },
        findById: async () => null,
        findByIds: async () => [],
        list: async () => ({ items: [], total: 0 }),
        countPlaylistReferences: async () => 0,
        delete: async () => false,
        update: async () => null,
      },
      contentStorage: storage.storage,
      contentMetadataExtractor: metadataExtractor,
      contentThumbnailGenerator: thumbnailGenerator,
      userRepository,
      cleanupFailureLogger: {
        logContentCleanupFailure: (input) => {
          loggerCalls.push(input);
        },
      },
    });

    const file = new File([new TextEncoder().encode("hello")], "photo.png", {
      type: "image/png",
    });
    await expect(
      useCase.execute({
        title: "Rollback failure",
        file,
        createdById: "user-1",
      }),
    ).rejects.toBeInstanceOf(ContentStorageCleanupError);
    expect(loggerCalls).toHaveLength(1);
    const payload = loggerCalls[0] as Record<string, unknown>;
    expect(payload.route).toBe("/content");
    expect(payload.failurePhase).toBe("upload_rollback_delete");
    expect(payload.contentId).toBeTypeOf("string");
    expect(payload.fileKey).toBeTypeOf("string");
  });

  test("returns presigned download url", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const useCase = new GetContentDownloadUrlUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      expiresInSeconds: 3600,
    });

    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Poster",
      type: "IMAGE",
      status: "DRAFT",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const result = await useCase.execute({
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.downloadUrl).toBe(
      "https://example.com/content/images/11111111-1111-4111-8111-111111111111.png",
    );
  });

  test("updates content title", async () => {
    const { repository, records } = makeContentRepository();
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const useCase = new UpdateContentUseCase({
      contentRepository: repository,
      userRepository,
    });

    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Old Title",
      type: "IMAGE",
      status: "DRAFT",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const result = await useCase.execute({
      id: "11111111-1111-4111-8111-111111111111",
      title: "New Title",
    });

    expect(result.title).toBe("New Title");
    expect(result.createdBy).toEqual({ id: "user-1", name: "Ada" });
  });

  test("throws when updating non-existent content", async () => {
    const { repository } = makeContentRepository();
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const useCase = new UpdateContentUseCase({
      contentRepository: repository,
      userRepository,
    });

    await expect(
      useCase.execute({ id: "missing-id", title: "New Title" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
