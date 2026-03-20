import { describe, expect, test } from "bun:test";
import {
  type ContentMetadataExtractor,
  type ContentRecord,
  type ContentRepository,
  type ContentStorage,
  type ContentThumbnailGenerator,
} from "#/application/ports/content";
import {
  type ContentIngestionJobRecord,
  type ContentIngestionJobRepository,
  type ContentIngestionQueue,
  type ContentJobEvent,
  type ContentJobEventPublisher,
} from "#/application/ports/content-jobs";
import { type ContentCleanupFailureLog } from "#/application/ports/observability";
import { type UserRepository } from "#/application/ports/rbac";
import {
  ContentInUseError,
  ContentStorageCleanupError,
  DeleteContentUseCase,
  GetContentDownloadUrlUseCase,
  GetContentUseCase,
  InvalidContentTypeError,
  ListContentUseCase,
  NotFoundError,
  ReplaceContentFileUseCase,
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
    findByIdForOwner: async (id, ownerId) =>
      records.find((item) => item.id === id && item.ownerId === ownerId) ??
      null,
    findByIdsForOwner: async (ids, ownerId) =>
      records.filter(
        (item) => ids.includes(item.id) && item.ownerId === ownerId,
      ),
    listForOwner: async ({ ownerId, offset, limit }) => {
      const owned = records.filter((item) => item.ownerId === ownerId);
      return {
        items: owned.slice(offset, offset + limit),
        total: owned.length,
      };
    },
    updateForOwner: async (id, ownerId, input) => {
      const index = records.findIndex(
        (item) => item.id === id && item.ownerId === ownerId,
      );
      if (index === -1) return null;
      const current = records[index];
      if (!current) return null;
      const next: ContentRecord = { ...current, ...input };
      records[index] = next;
      return next;
    },
    deleteForOwner: async (id, ownerId) => {
      const index = records.findIndex(
        (item) => item.id === id && item.ownerId === ownerId,
      );
      if (index === -1) return false;
      records.splice(index, 1);
      return true;
    },
    delete: async (id) => {
      const index = records.findIndex((item) => item.id === id);
      if (index === -1) return false;
      records.splice(index, 1);
      return true;
    },
    update: async (id, input) => {
      const index = records.findIndex((item) => item.id === id);
      if (index === -1) return null;
      const current = records[index];
      if (!current) return null;
      const next: ContentRecord = {
        ...current,
        ...input,
      };
      records[index] = next;
      return next;
    },
  };

  return { records, repository };
};

const makeUserRepository = (users: Array<{ id: string; name: string }>) =>
  ({
    list: async () =>
      users.map((user) => ({
        id: user.id,
        username: user.id,
        email: `${user.id}@example.com`,
        name: user.name,
        isActive: true,
      })),
    findById: async (id: string) => {
      const user = users.find((item) => item.id === id);
      if (!user) return null;
      return {
        id: user.id,
        username: user.id,
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
          username: user.id,
          email: `${user.id}@example.com`,
          name: user.name,
          isActive: true,
        })),
    findByUsername: async () => null,
    findByEmail: async () => null,
    create: async () => {
      throw new Error("not needed in test");
    },
    update: async () => null,
    delete: async () => false,
  }) satisfies UserRepository;

const makeStorage = (options?: {
  uploadErrorAt?: number;
  uploadError?: Error;
  deleteError?: Error;
}) => {
  type UploadInput = Parameters<ContentStorage["upload"]>[0];
  const uploads: UploadInput[] = [];
  const deletedKeys: string[] = [];
  let uploadCount = 0;

  const storage: ContentStorage = {
    ensureBucketExists: async () => {},
    upload: async (input) => {
      uploads.push(input);
      uploadCount += 1;
      if (
        options?.uploadError &&
        (options.uploadErrorAt === undefined ||
          uploadCount === options.uploadErrorAt)
      ) {
        throw options.uploadError;
      }
    },
    delete: async (key) => {
      deletedKeys.push(key);
      if (options?.deleteError) {
        throw options.deleteError;
      }
    },
    getPresignedDownloadUrl: async ({ key }) => `https://example.com/${key}`,
    checkConnectivity: async () => ({ ok: true }),
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

const makeIngestionDeps = (options?: {
  createError?: Error;
  enqueueError?: Error;
}) => {
  type JobUpdateInput = Parameters<ContentIngestionJobRepository["update"]>[1];

  const createdJobs: ContentIngestionJobRecord[] = [];
  const updatedJobs: Array<{ id: string; input: JobUpdateInput }> = [];
  const queuedJobIds: string[] = [];
  const publishedEvents: ContentJobEvent[] = [];
  const jobsById = new Map<string, ContentIngestionJobRecord>();

  const contentIngestionJobRepository: ContentIngestionJobRepository = {
    create: async (input) => {
      if (options?.createError) {
        throw options.createError;
      }
      const now = new Date().toISOString();
      const record: ContentIngestionJobRecord = {
        id: input.id,
        contentId: input.contentId,
        operation: input.operation,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        ownerId: input.ownerId,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
      };
      jobsById.set(record.id, record);
      createdJobs.push(record);
      return record;
    },
    findById: async (id) => jobsById.get(id) ?? null,
    update: async (id, input) => {
      const existing = jobsById.get(id);
      if (!existing) {
        return null;
      }
      const next: ContentIngestionJobRecord = {
        ...existing,
        status: input.status ?? existing.status,
        errorMessage:
          input.errorMessage === undefined
            ? existing.errorMessage
            : input.errorMessage,
        startedAt:
          input.startedAt === undefined ? existing.startedAt : input.startedAt,
        completedAt:
          input.completedAt === undefined
            ? existing.completedAt
            : input.completedAt,
        updatedAt: new Date().toISOString(),
      };
      jobsById.set(id, next);
      updatedJobs.push({ id, input });
      return next;
    },
  };

  const contentIngestionQueue: ContentIngestionQueue = {
    enqueue: async ({ jobId }) => {
      queuedJobIds.push(jobId);
      if (options?.enqueueError) {
        throw options.enqueueError;
      }
    },
  };

  const contentJobEventPublisher: ContentJobEventPublisher = {
    publish: (event) => {
      publishedEvents.push(event);
    },
  };

  return {
    contentIngestionJobRepository,
    contentIngestionQueue,
    contentJobEventPublisher,
    createdJobs,
    updatedJobs,
    queuedJobIds,
    publishedEvents,
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
      ownerId: "user-1",
    });

    expect(result.content.title).toBe("Welcome");
    expect(result.content.type).toBe("IMAGE");
    expect(result.content.status).toBe("PROCESSING");
    expect(result.content.checksum).toBe(checksum);
    expect(result.content.owner).toEqual({ id: "user-1", name: "Ada" });
    expect(storage.lastUpload?.contentType).toBe("image/png");
    expect(storage.lastUpload?.key).toBe(
      `content/images/${result.content.id}.png`,
    );
  });

  test("uploads source file and queues ingestion job", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const ingestion = makeIngestionDeps();
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    let thumbnailCalls = 0;
    const useCase = new UploadContentUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      contentMetadataExtractor: metadataExtractor,
      contentThumbnailGenerator: {
        generate: async () => {
          thumbnailCalls += 1;
          return new Uint8Array([1, 2, 3]);
        },
      },
      ...ingestion,
      userRepository,
    });

    const file = new File([new TextEncoder().encode("hello")], "photo.png", {
      type: "image/png",
    });

    const result = await useCase.execute({
      title: "Welcome",
      file,
      ownerId: "user-1",
    });

    expect(thumbnailCalls).toBe(0);
    expect(storage.uploads).toHaveLength(1);
    expect(storage.uploads[0]?.key).toBe(
      `content/images/${result.content.id}.png`,
    );
    expect(records[0]?.thumbnailKey).toBeNull();
    expect(result.job.operation).toBe("UPLOAD");
    expect(result.job.status).toBe("QUEUED");
    expect(ingestion.createdJobs).toHaveLength(1);
    expect(ingestion.queuedJobIds).toEqual([result.job.id]);
    expect(ingestion.publishedEvents[0]?.type).toBe("queued");
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
      useCase.execute({ title: "Invalid", file, ownerId: "user-1" }),
    ).rejects.toBeInstanceOf(InvalidContentTypeError);
  });

  test("throws when owner does not exist", async () => {
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
      useCase.execute({ title: "Missing user", file, ownerId: "user-1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("lists content with pagination and owner names", async () => {
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
        status: "READY",
        fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
        thumbnailKey:
          "content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
        checksum: "abc",
        mimeType: "image/png",
        fileSize: 10,
        width: null,
        height: null,
        duration: null,
        ownerId: "user-1",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Two",
        type: "IMAGE",
        status: "READY",
        fileKey: "content/images/22222222-2222-4222-8222-222222222222.png",
        checksum: "def",
        mimeType: "image/png",
        fileSize: 20,
        width: null,
        height: null,
        duration: null,
        ownerId: "user-2",
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
    expect(result.items[0]?.owner).toEqual({
      id: "user-1",
      name: "Ada",
    });
    expect(result.items[0]?.thumbnailUrl).toBe(
      "https://example.com/content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
    );
  });

  test("passes sortBy to repository for list queries", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    let observedSortBy: string | undefined;
    let observedSortDirection: string | undefined;
    const trackedRepository = {
      ...repository,
      list: async (input: {
        offset: number;
        limit: number;
        status?: "PROCESSING" | "READY" | "FAILED";
        type?: "IMAGE" | "VIDEO" | "FLASH" | "TEXT";
        search?: string;
        sortBy?: "createdAt" | "title" | "fileSize" | "type";
        sortDirection?: "asc" | "desc";
      }) => {
        observedSortBy = input.sortBy;
        observedSortDirection = input.sortDirection;
        return {
          items: records.slice(input.offset, input.offset + input.limit),
          total: records.length,
        };
      },
    } satisfies ContentRepository;

    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Item 1",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const useCase = new ListContentUseCase({
      contentRepository: trackedRepository,
      userRepository,
      contentStorage: storage.storage,
      thumbnailUrlExpiresInSeconds: 3600,
    });

    await useCase.execute({
      sortBy: "title",
      sortDirection: "asc",
    });

    expect(observedSortBy).toBe("title");
    expect(observedSortDirection).toBe("asc");
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
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      thumbnailKey:
        "content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const result = await useCase.execute({
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(result.owner.name).toBe("Ada");
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
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
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
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      thumbnailKey:
        "content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
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
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const loggerCalls: unknown[] = [];
    const loggingUseCase = new DeleteContentUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      cleanupFailureLogger: {
        logContentCleanupFailure: (input: ContentCleanupFailureLog) => {
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

  test("propagates enqueue errors even when upload cleanup delete fails", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage({ deleteError: new Error("cleanup failed") });
    const ingestion = makeIngestionDeps({
      enqueueError: new Error("enqueue failed"),
    });
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const useCase = new UploadContentUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      contentMetadataExtractor: metadataExtractor,
      contentThumbnailGenerator: thumbnailGenerator,
      ...ingestion,
      userRepository,
    });

    const file = new File([new TextEncoder().encode("hello")], "photo.png", {
      type: "image/png",
    });
    await expect(
      useCase.execute({
        title: "Rollback failure",
        file,
        ownerId: "user-1",
      }),
    ).rejects.toThrow("enqueue failed");
    expect(records[0]?.status).toBe("FAILED");
    const rollbackFailedFileKey = records[0]?.fileKey;
    expect(rollbackFailedFileKey).toBeTypeOf("string");
    expect(storage.deletedKeys).toEqual([rollbackFailedFileKey ?? ""]);
    expect(ingestion.updatedJobs).toHaveLength(1);
    expect(ingestion.updatedJobs[0]?.input.status).toBe("FAILED");
    expect(ingestion.publishedEvents[0]?.type).toBe("failed");
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
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
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
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const result = await useCase.execute({
      id: "11111111-1111-4111-8111-111111111111",
      title: "New Title",
    });

    expect(result.title).toBe("New Title");
    expect(result.owner).toEqual({ id: "user-1", name: "Ada" });
  });

  test("updates TEXT content, checksum, and stored payload", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const useCase = new UpdateContentUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      userRepository,
    });

    const id = "11111111-1111-4111-8111-111111111111";
    const nextTextJsonContent =
      '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Updated text"}]}]}';
    const nextTextHtmlContent = "<p>Updated text</p>";
    const expectedFileSize = new TextEncoder().encode(
      nextTextJsonContent,
    ).byteLength;
    const expectedChecksum = await sha256Hex(
      new TextEncoder().encode(
        JSON.stringify({
          jsonContent: nextTextJsonContent,
          htmlContent: nextTextHtmlContent,
        }),
      ).buffer,
    );

    records.push({
      id,
      title: "Rich Text",
      type: "TEXT",
      status: "READY",
      fileKey: "content/text/11111111-1111-4111-8111-111111111111.json",
      checksum: "old-checksum",
      mimeType: "application/json",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      textJsonContent:
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Old text"}]}]}',
      textHtmlContent: "<p>Old text</p>",
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const result = await useCase.execute({
      id,
      textJsonContent: nextTextJsonContent,
      textHtmlContent: nextTextHtmlContent,
    });

    expect(result.textJsonContent).toBe(nextTextJsonContent);
    expect(result.textHtmlContent).toBe(nextTextHtmlContent);
    expect(result.fileSize).toBe(expectedFileSize);
    expect(result.checksum).toBe(expectedChecksum);
    expect(storage.lastUpload?.key).toBe(
      "content/text/11111111-1111-4111-8111-111111111111.json",
    );
    expect(storage.lastUpload?.contentType).toBe(
      "application/json; charset=utf-8",
    );
    expect(storage.lastUpload?.contentLength).toBe(expectedFileSize);
    expect(new TextDecoder().decode(storage.lastUpload?.body)).toBe(
      nextTextJsonContent,
    );
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

  test("replaces file, clears derived metadata, and queues ingestion job", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const ingestion = makeIngestionDeps();
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    let metadataCalls = 0;
    let thumbnailCalls = 0;
    const useCase = new ReplaceContentFileUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      contentMetadataExtractor: {
        extract: async () => {
          metadataCalls += 1;
          return { width: 1920, height: 1080, duration: 42 };
        },
      },
      contentThumbnailGenerator: {
        generate: async () => {
          thumbnailCalls += 1;
          return new Uint8Array([1, 2, 3]);
        },
      },
      ...ingestion,
      userRepository,
      cleanupFailureLogger: {
        logContentCleanupFailure: () => undefined,
      },
    });
    const id = "11111111-1111-4111-8111-111111111111";
    records.push({
      id,
      title: "Before",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      thumbnailKey:
        "content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
      checksum: "old",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const file = new File([new TextEncoder().encode("video")], "clip.mp4", {
      type: "video/mp4",
    });
    const result = await useCase.execute({
      id,
      file,
      title: "After",
      status: "READY",
    });

    expect(result.content.title).toBe("After");
    expect(result.content.status).toBe("PROCESSING");
    expect(result.content.type).toBe("VIDEO");
    expect(result.content.mimeType).toBe("video/mp4");
    expect(result.content.fileSize).toBe(file.size);
    expect(result.content.width).toBeNull();
    expect(result.content.height).toBeNull();
    expect(result.content.duration).toBeNull();
    expect(metadataCalls).toBe(0);
    expect(thumbnailCalls).toBe(0);
    expect(storage.uploads).toHaveLength(1);
    expect(storage.uploads[0]?.key).toBe(`content/videos/${id}.mp4`);
    expect(storage.deletedKeys).toEqual([
      "content/images/11111111-1111-4111-8111-111111111111.png",
      "content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
    ]);
    expect(result.job.operation).toBe("REPLACE");
    expect(result.job.status).toBe("QUEUED");
    expect(ingestion.queuedJobIds).toEqual([result.job.id]);
  });

  test("rejects replace when content is processing", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const useCase = new ReplaceContentFileUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      contentMetadataExtractor: metadataExtractor,
      contentThumbnailGenerator: thumbnailGenerator,
      userRepository,
    });
    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Poster",
      type: "IMAGE",
      status: "PROCESSING",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const file = new File([new TextEncoder().encode("hello")], "poster.png", {
      type: "image/png",
    });
    await expect(
      useCase.execute({ id: "11111111-1111-4111-8111-111111111111", file }),
    ).rejects.toBeInstanceOf(ContentInUseError);
  });

  test("does not invoke metadata extraction during replace flow", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const ingestion = makeIngestionDeps();
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    let metadataCalls = 0;
    let thumbnailCalls = 0;
    const useCase = new ReplaceContentFileUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      contentMetadataExtractor: {
        extract: async () => {
          metadataCalls += 1;
          throw new Error("metadata should not run");
        },
      },
      contentThumbnailGenerator: {
        generate: async () => {
          thumbnailCalls += 1;
          throw new Error("thumbnail should not run");
        },
      },
      ...ingestion,
      userRepository,
    });
    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Poster",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const file = new File([new TextEncoder().encode("hello")], "poster.png", {
      type: "image/png",
    });
    const result = await useCase.execute({
      id: "11111111-1111-4111-8111-111111111111",
      file,
    });

    expect(metadataCalls).toBe(0);
    expect(thumbnailCalls).toBe(0);
    expect(result.content.status).toBe("PROCESSING");
    expect(result.job.status).toBe("QUEUED");
  });

  test("marks upload and job as failed when enqueue fails", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const ingestion = makeIngestionDeps({
      enqueueError: new Error("queue unavailable"),
    });
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const useCase = new UploadContentUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      contentMetadataExtractor: metadataExtractor,
      contentThumbnailGenerator: thumbnailGenerator,
      ...ingestion,
      userRepository,
    });

    const file = new File([new TextEncoder().encode("hello")], "photo.png", {
      type: "image/png",
    });

    await expect(
      useCase.execute({
        title: "Queue failure",
        file,
        ownerId: "user-1",
      }),
    ).rejects.toThrow("queue unavailable");

    expect(records[0]?.status).toBe("FAILED");
    const queueFailedFileKey = records[0]?.fileKey;
    expect(queueFailedFileKey).toBeTypeOf("string");
    expect(storage.deletedKeys).toEqual([queueFailedFileKey ?? ""]);
    expect(ingestion.createdJobs).toHaveLength(1);
    expect(ingestion.updatedJobs).toHaveLength(1);
    expect(ingestion.updatedJobs[0]?.input.status).toBe("FAILED");
    expect(ingestion.publishedEvents[0]?.type).toBe("failed");
  });

  test("marks upload as failed and rolls back file when job creation fails", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const ingestion = makeIngestionDeps({
      createError: new Error("job create failed"),
    });
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const useCase = new UploadContentUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      contentMetadataExtractor: metadataExtractor,
      contentThumbnailGenerator: thumbnailGenerator,
      ...ingestion,
      userRepository,
    });

    const file = new File([new TextEncoder().encode("hello")], "photo.png", {
      type: "image/png",
    });

    await expect(
      useCase.execute({
        title: "Create job failure",
        file,
        ownerId: "user-1",
      }),
    ).rejects.toThrow("job create failed");

    expect(records[0]?.status).toBe("FAILED");
    const createFailedFileKey = records[0]?.fileKey;
    expect(createFailedFileKey).toBeTypeOf("string");
    expect(storage.deletedKeys).toEqual([createFailedFileKey ?? ""]);
    expect(ingestion.queuedJobIds).toHaveLength(0);
    expect(ingestion.updatedJobs).toHaveLength(0);
  });

  test("marks replacement content and job as failed when enqueue fails", async () => {
    const { repository, records } = makeContentRepository();
    const storage = makeStorage();
    const ingestion = makeIngestionDeps({
      enqueueError: new Error("queue unavailable"),
    });
    const userRepository = makeUserRepository([{ id: "user-1", name: "Ada" }]);
    const useCase = new ReplaceContentFileUseCase({
      contentRepository: repository,
      contentStorage: storage.storage,
      contentMetadataExtractor: metadataExtractor,
      contentThumbnailGenerator: thumbnailGenerator,
      ...ingestion,
      userRepository,
    });
    records.push({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Poster",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/11111111-1111-4111-8111-111111111111.png",
      thumbnailKey:
        "content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const file = new File([new TextEncoder().encode("hello")], "photo.png", {
      type: "image/png",
    });

    await expect(
      useCase.execute({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Queue failure",
        status: "READY",
        file,
      }),
    ).rejects.toThrow("queue unavailable");

    expect(records[0]?.status).toBe("FAILED");
    expect(storage.uploads).toHaveLength(1);
    expect(storage.deletedKeys).toEqual([
      "content/thumbnails/11111111-1111-4111-8111-111111111111.jpg",
    ]);
    expect(ingestion.createdJobs).toHaveLength(1);
    expect(ingestion.updatedJobs).toHaveLength(1);
    expect(ingestion.updatedJobs[0]?.input.status).toBe("FAILED");
    expect(ingestion.publishedEvents[0]?.type).toBe("failed");
  });
});
