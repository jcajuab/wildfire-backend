import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type CleanupFailureLogger } from "#/application/ports/observability";
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
      cleanupFailureLogger?: CleanupFailureLogger;
    },
  ) {}

  async execute(input: { id: string }) {
    const record = await this.deps.contentRepository.findById(input.id);
    if (!record) {
      throw new NotFoundError("Content not found");
    }

    const playlistReferences =
      await this.deps.contentRepository.countPlaylistReferences(input.id);
    if (playlistReferences > 0) {
      throw new ContentInUseError(
        `Content is used by ${playlistReferences} playlist item(s). Remove dependencies before deleting.`,
      );
    }

    const deleted = await this.deps.contentRepository.delete(input.id);
    if (!deleted) {
      throw new NotFoundError("Content not found");
    }
    // Storage deletion after DB commit: orphan files are recoverable,
    // ghost DB records pointing to missing files are not.
    try {
      await this.deps.contentStorage.delete(record.fileKey);
    } catch (cleanupError) {
      this.deps.cleanupFailureLogger?.logContentCleanupFailure({
        route: "/content/:id",
        contentId: input.id,
        fileKey: record.fileKey,
        failurePhase: "delete_after_metadata_remove",
        error: cleanupError,
      });
      throw new ContentStorageCleanupError(
        "Content metadata was deleted but storage cleanup did not complete.",
        { contentId: input.id, fileKey: record.fileKey },
        { cause: cleanupError },
      );
    }
  }
}
