import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type CleanupFailureLogger } from "#/application/ports/observability";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  ContentInUseError,
  ContentStorageCleanupError,
  NotFoundError,
} from "./errors";

export class DeleteContentUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      contentStorage: ContentStorage;
      scheduleRepository?: ScheduleRepository;
      cleanupFailureLogger?: CleanupFailureLogger;
    },
  ) {}

  async execute(input: { id: string; ownerId?: string }) {
    const record =
      input.ownerId && this.deps.contentRepository.findByIdForOwner
        ? await this.deps.contentRepository.findByIdForOwner(
            input.id,
            input.ownerId,
          )
        : await this.deps.contentRepository.findById(input.id);
    if (!record) {
      throw new NotFoundError("Content not found");
    }

    const playlistReferenceCount =
      await this.deps.contentRepository.countPlaylistReferences(input.id);
    if (playlistReferenceCount > 0) {
      const message =
        playlistReferenceCount > 1
          ? "Failed to delete content. This content is in use by multiple playlists."
          : "Failed to delete content. This content is in use by a playlist.";
      throw new ContentInUseError(message);
    }
    if (record.type === "FLASH" && this.deps.scheduleRepository) {
      const scheduledFlashCount =
        (await this.deps.scheduleRepository.countByContentId?.(record.id)) ?? 0;
      if (scheduledFlashCount > 0) {
        throw new ContentInUseError(
          "Failed to delete content. This flash content is in use by a schedule.",
        );
      }
    }

    const children =
      record.kind === "ROOT" &&
      this.deps.contentRepository.findChildrenByParentIds
        ? input.ownerId &&
          this.deps.contentRepository.findChildrenByParentIdsForOwner
          ? await this.deps.contentRepository.findChildrenByParentIdsForOwner(
              [record.id],
              input.ownerId,
              {
                includeExcluded: true,
              },
            )
          : await this.deps.contentRepository.findChildrenByParentIds(
              [record.id],
              {
                includeExcluded: true,
              },
            )
        : [];

    const deleted =
      input.ownerId && this.deps.contentRepository.deleteForOwner
        ? await this.deps.contentRepository.deleteForOwner(
            input.id,
            input.ownerId,
          )
        : await this.deps.contentRepository.delete(input.id);
    if (!deleted) {
      throw new NotFoundError("Content not found");
    }

    // Storage deletion after DB commit: orphan files are recoverable,
    // ghost DB records pointing to missing files are not.
    const keysToDelete = [
      record.fileKey,
      ...(record.thumbnailKey ? [record.thumbnailKey] : []),
      ...children.map((child) => child.fileKey),
      ...children
        .map((child) => child.thumbnailKey)
        .filter((key): key is string => key != null),
    ];
    for (const key of keysToDelete) {
      try {
        await this.deps.contentStorage.delete(key);
      } catch (cleanupError) {
        this.deps.cleanupFailureLogger?.logContentCleanupFailure({
          route: "/content/:id",
          contentId: input.id,
          fileKey: key,
          failurePhase: "delete_after_metadata_remove",
          error: cleanupError,
        });
        throw new ContentStorageCleanupError(
          "Content metadata was deleted but storage cleanup did not complete.",
          { contentId: input.id, fileKey: key },
          { cause: cleanupError },
        );
      }
    }
  }
}
