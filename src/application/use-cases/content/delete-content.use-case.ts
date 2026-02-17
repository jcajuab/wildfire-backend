import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { ContentInUseError, NotFoundError } from "./errors";

export class DeleteContentUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      contentStorage: ContentStorage;
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

    await this.deps.contentStorage.delete(record.fileKey);
    const deleted = await this.deps.contentRepository.delete(input.id);
    if (!deleted) {
      throw new NotFoundError("Content not found");
    }
  }
}
