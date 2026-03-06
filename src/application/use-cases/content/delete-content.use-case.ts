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

  async execute(input: { id: string }) {
    const record = await this.deps.contentRepository.findById(input.id);
    if (!record) {
      throw new NotFoundError("Content not found");
    }

    const referencingPlaylists =
      await this.deps.contentRepository.listPlaylistsReferencingContent(
        input.id,
      );
    if (referencingPlaylists.length > 0) {
      const firstPlaylist = referencingPlaylists[0];
      const playlistName = firstPlaylist?.name?.trim() || "a playlist";
      const message =
        referencingPlaylists.length > 1
          ? "Failed to delete content. This content is in use by multiple playlists."
          : `Failed to delete content. This content is in use by ${playlistName}.`;
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
        ? await this.deps.contentRepository.findChildrenByParentIds(
            [record.id],
            {
              includeExcluded: true,
            },
          )
        : [];

    const deleted = await this.deps.contentRepository.delete(input.id);
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
