import {
  type ContentRecord,
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type ContentPlaylistReportingPort } from "#/application/ports/content-playlist-reporting";
import { type UserRepository } from "#/application/ports/rbac";
import { toContentView } from "./content-view";
import { NotFoundError } from "./errors";

export class GetContentUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      userRepository: UserRepository;
      contentStorage: ContentStorage;
      thumbnailUrlExpiresInSeconds: number;
      contentPlaylistReportingPort?: ContentPlaylistReportingPort;
    },
  ) {}

  private async buildThumbnailUrl(
    record: ContentRecord,
  ): Promise<string | undefined> {
    if (!record.thumbnailKey) {
      return undefined;
    }

    try {
      return await this.deps.contentStorage.getPresignedDownloadUrl({
        key: record.thumbnailKey,
        expiresInSeconds: this.deps.thumbnailUrlExpiresInSeconds,
      });
    } catch {
      return undefined;
    }
  }

  async execute(input: {
    id: string;
    ownerId?: string;
    currentUser?: {
      id: string;
      username: string;
    };
  }) {
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

    const [user, thumbnailUrl, playlistReferences] = await Promise.all([
      this.deps.userRepository.findById(record.ownerId),
      this.buildThumbnailUrl(record),
      this.deps.contentPlaylistReportingPort?.countPlaylistReferences(
        record.id,
      ) ?? Promise.resolve(0),
    ]);
    return toContentView(record, user, {
      fallbackOwner: input.currentUser,
      thumbnailUrl,
      isUsedInPlaylist: playlistReferences > 0,
    });
  }
}
