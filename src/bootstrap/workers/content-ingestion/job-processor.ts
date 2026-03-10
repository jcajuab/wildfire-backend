import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { type ContentRecord } from "#/application/ports/content";
import { sha256Hex } from "#/domain/content/checksum";
import {
  buildContentPageFileKey,
  buildContentThumbnailKey,
  resolveContentType,
} from "#/domain/content/content";
import { publishContentJobEvent } from "#/infrastructure/content-jobs/content-job-events";
import { db } from "#/infrastructure/db/client";
import {
  contentAssets as contentAssetsTable,
  content as contentTable,
} from "#/infrastructure/db/schema/content.sql";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import { sleep } from "#/shared/retry";
import { contentIngestionContainer } from "./runtime";

const THUMBNAIL_MAX_RETRIES = 3;
const THUMBNAIL_RETRY_DELAY_MS = 500;

const toPositiveInt = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.max(1, Math.round(value));
};

const toArrayBuffer = (data: Uint8Array): ArrayBuffer => {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
};

const runWithThumbnailRetries = async (input: {
  type: "IMAGE" | "VIDEO" | "PDF";
  mimeType: string;
  data: Uint8Array;
  generateThumbnail: (args: {
    type: "IMAGE" | "VIDEO" | "PDF";
    mimeType: string;
    data: Uint8Array;
  }) => Promise<Uint8Array | null>;
}): Promise<Uint8Array | null> => {
  for (let attempt = 1; attempt <= THUMBNAIL_MAX_RETRIES; attempt += 1) {
    try {
      const thumbnail = await input.generateThumbnail({
        type: input.type,
        mimeType: input.mimeType,
        data: input.data,
      });
      if (thumbnail) {
        return thumbnail;
      }
    } catch {
      if (attempt < THUMBNAIL_MAX_RETRIES) {
        await sleep(THUMBNAIL_RETRY_DELAY_MS);
      }
    }
  }
  return null;
};

const deleteExistingChildren = async (parent: ContentRecord): Promise<void> => {
  const contentRepository =
    contentIngestionContainer.repositories.contentRepository;
  const contentStorage = contentIngestionContainer.storage.contentStorage;

  const existingChildren = contentRepository.findChildrenByParentIds
    ? await contentRepository.findChildrenByParentIds([parent.id], {
        includeExcluded: true,
      })
    : [];

  for (const existingChild of existingChildren) {
    await contentStorage.delete(existingChild.fileKey).catch((error) => {
      logger.warn(
        addErrorContext(
          {
            operation: "storage_cleanup",
            key: existingChild.fileKey,
            contentId: existingChild.id,
          },
          error,
        ),
        "Failed to delete storage object",
      );
    });
    if (existingChild.thumbnailKey) {
      await contentStorage.delete(existingChild.thumbnailKey).catch((error) => {
        logger.warn(
          addErrorContext(
            {
              operation: "storage_cleanup",
              key: existingChild.thumbnailKey,
              contentId: existingChild.id,
            },
            error,
          ),
          "Failed to delete thumbnail storage object",
        );
      });
    }
  }

  if (existingChildren.length === 0) {
    return;
  }

  if (contentRepository.deleteByParentId) {
    await contentRepository.deleteByParentId(parent.id);
    return;
  }

  for (const existingChild of existingChildren) {
    await contentRepository.delete(existingChild.id);
  }
};

export const processContentIngestionJob = async (
  jobId: string,
): Promise<void> => {
  const jobRepository =
    contentIngestionContainer.repositories.contentIngestionJobRepository;
  const contentRepository =
    contentIngestionContainer.repositories.contentRepository;
  const contentStorage = contentIngestionContainer.storage.contentStorage;
  const metadataExtractor =
    contentIngestionContainer.storage.contentMetadataExtractor;
  const thumbnailGenerator =
    contentIngestionContainer.storage.contentThumbnailGenerator;

  const job = await jobRepository.findById(jobId);
  if (!job) {
    return;
  }
  const startedAt = new Date().toISOString();
  await jobRepository.update(job.id, {
    status: "PROCESSING",
    errorMessage: null,
    startedAt,
    completedAt: null,
  });
  publishContentJobEvent({
    type: "processing",
    jobId: job.id,
    contentId: job.contentId,
    timestamp: startedAt,
    status: "PROCESSING",
    message: "Content ingestion started",
  });

  const content = await contentRepository.findById(job.contentId);
  if (!content) {
    throw new Error("Content not found for ingestion job");
  }

  const contentType = resolveContentType(content.mimeType);
  if (!contentType) {
    throw new Error("Unsupported content type for ingestion");
  }

  const data = await contentStorage.download?.(content.fileKey);
  if (!data) {
    throw new Error("Failed to download content file");
  }
  const metadata = await metadataExtractor.extract({
    type: contentType,
    mimeType: content.mimeType,
    data,
  });

  const generatedThumbnail = await runWithThumbnailRetries({
    type: contentType,
    mimeType: content.mimeType,
    data,
    generateThumbnail: (args) => thumbnailGenerator.generate(args),
  });

  let thumbnailKey: string | null = null;
  if (generatedThumbnail) {
    const candidateThumbnailKey = buildContentThumbnailKey(content.id);
    await contentStorage
      .upload({
        key: candidateThumbnailKey,
        body: generatedThumbnail,
        contentType: "image/jpeg",
        contentLength: generatedThumbnail.byteLength,
      })
      .then(() => {
        thumbnailKey = candidateThumbnailKey;
      })
      .catch((error) => {
        logger.warn(
          addErrorContext(
            {
              operation: "thumbnail_upload",
              key: candidateThumbnailKey,
              contentId: content.id,
            },
            error,
          ),
          "Failed to upload thumbnail",
        );
      });
  }

  if (content.thumbnailKey && content.thumbnailKey !== thumbnailKey) {
    await contentStorage.delete(content.thumbnailKey).catch((error) => {
      logger.warn(
        addErrorContext(
          {
            operation: "storage_cleanup",
            key: content.thumbnailKey,
            contentId: content.id,
          },
          error,
        ),
        "Failed to delete old thumbnail",
      );
    });
  }

  let pageCount: number | null = null;
  if (content.kind === "ROOT" && contentType === "PDF") {
    // Wrap PDF child processing + parent update in a transaction for atomicity
    await db.transaction(async (tx) => {
      // Delete existing children from database
      await tx
        .delete(contentTable)
        .where(eq(contentTable.parentContentId, content.id));

      // Process PDF pages
      const sourcePdf = await PDFDocument.load(data);
      pageCount = sourcePdf.getPageCount();
      const now = new Date();

      for (let index = 0; index < pageCount; index += 1) {
        const pageNumber = index + 1;
        const childId = randomUUID();
        const pageDocument = await PDFDocument.create();
        const copiedPages = await pageDocument.copyPages(sourcePdf, [index]);
        const copiedPage = copiedPages[0];
        if (!copiedPage) {
          throw new Error(`Failed to copy PDF page ${String(pageNumber)}`);
        }
        pageDocument.addPage(copiedPage);
        const pageBytes = new Uint8Array(await pageDocument.save());
        const pageChecksum = await sha256Hex(toArrayBuffer(pageBytes));
        const pageFileKey = buildContentPageFileKey({
          parentId: content.id,
          pageNumber,
        });

        // Upload to storage (outside transaction is fine - storage operations are idempotent)
        await contentStorage.upload({
          key: pageFileKey,
          body: pageBytes,
          contentType: "application/pdf",
          contentLength: pageBytes.byteLength,
        });

        const generatedThumbnail = await runWithThumbnailRetries({
          type: "PDF",
          mimeType: "application/pdf",
          data: pageBytes,
          generateThumbnail: (args) => thumbnailGenerator.generate(args),
        });
        let pageThumbnailKey: string | null = null;
        if (generatedThumbnail) {
          const candidateThumbnailKey = buildContentThumbnailKey(childId);
          await contentStorage
            .upload({
              key: candidateThumbnailKey,
              body: generatedThumbnail,
              contentType: "image/jpeg",
              contentLength: generatedThumbnail.byteLength,
            })
            .then(() => {
              pageThumbnailKey = candidateThumbnailKey;
            })
            .catch((error) => {
              logger.warn(
                addErrorContext(
                  {
                    operation: "thumbnail_upload",
                    key: candidateThumbnailKey,
                    contentId: childId,
                    pageNumber,
                  },
                  error,
                ),
                "Failed to upload page thumbnail",
              );
            });
        }

        const pageSize = copiedPage.getSize();

        // Insert child content record in transaction
        await tx.insert(contentTable).values({
          id: childId,
          title: `${content.title} - Page ${String(pageNumber)}`,
          type: "PDF",
          kind: "PAGE",
          status: "READY",
          parentContentId: content.id,
          pageNumber,
          pageCount,
          isExcluded: false,
          ownerId: content.ownerId,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(contentAssetsTable).values({
          contentId: childId,
          fileKey: pageFileKey,
          thumbnailKey: pageThumbnailKey,
          checksum: pageChecksum,
          mimeType: "application/pdf",
          fileSize: pageBytes.byteLength,
          width: toPositiveInt(pageSize.width),
          height: toPositiveInt(pageSize.height),
          duration: null,
          scrollPxPerSecond: null,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Update parent content in the same transaction
      await tx
        .update(contentTable)
        .set({
          type: contentType,
          status: "READY",
          pageCount,
          isExcluded: false,
          updatedAt: now,
        })
        .where(eq(contentTable.id, content.id));

      await tx
        .insert(contentAssetsTable)
        .values({
          contentId: content.id,
          fileKey: content.fileKey,
          thumbnailKey,
          checksum: content.checksum,
          mimeType: content.mimeType,
          fileSize: data.byteLength,
          width: metadata.width,
          height: metadata.height,
          duration: metadata.duration,
          scrollPxPerSecond: null,
          createdAt: now,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            fileKey: content.fileKey,
            thumbnailKey,
            checksum: content.checksum,
            mimeType: content.mimeType,
            fileSize: data.byteLength,
            width: metadata.width,
            height: metadata.height,
            duration: metadata.duration,
            scrollPxPerSecond: null,
            updatedAt: now,
          },
        });
    });

    // Storage cleanup happens outside transaction (best effort)
    const existingChildren = contentRepository.findChildrenByParentIds
      ? await contentRepository.findChildrenByParentIds([content.id], {
          includeExcluded: true,
        })
      : [];
    for (const existingChild of existingChildren) {
      await contentStorage.delete(existingChild.fileKey).catch((error) => {
        logger.warn(
          addErrorContext(
            {
              operation: "storage_cleanup",
              key: existingChild.fileKey,
              contentId: existingChild.id,
            },
            error,
          ),
          "Failed to delete storage object",
        );
      });
      if (existingChild.thumbnailKey) {
        await contentStorage
          .delete(existingChild.thumbnailKey)
          .catch((error) => {
            logger.warn(
              addErrorContext(
                {
                  operation: "storage_cleanup",
                  key: existingChild.thumbnailKey,
                  contentId: existingChild.id,
                },
                error,
              ),
              "Failed to delete thumbnail storage object",
            );
          });
      }
    }
  } else if (content.kind === "ROOT") {
    await deleteExistingChildren(content);
    await contentRepository.update(content.id, {
      type: contentType,
      status: "READY",
      thumbnailKey,
      mimeType: content.mimeType,
      fileSize: data.byteLength,
      width: metadata.width,
      height: metadata.height,
      duration: metadata.duration,
      pageCount: null,
      isExcluded: false,
    });
  } else {
    // PAGE kind
    await contentRepository.update(content.id, {
      type: contentType,
      status: "READY",
      thumbnailKey,
      mimeType: content.mimeType,
      fileSize: data.byteLength,
      width: metadata.width,
      height: metadata.height,
      duration: metadata.duration,
      pageCount: content.pageCount,
      isExcluded: content.isExcluded,
    });
  }

  const completedAt = new Date().toISOString();
  await jobRepository.update(job.id, {
    status: "SUCCEEDED",
    errorMessage: null,
    completedAt,
  });
  publishContentJobEvent({
    type: "succeeded",
    jobId: job.id,
    contentId: job.contentId,
    timestamp: completedAt,
    status: "SUCCEEDED",
    message: "Content ingestion completed",
  });
};
