import {
  type ContentRecord,
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
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

  async execute(input: { id: string }) {
    const record = await this.deps.contentRepository.findById(input.id);
    if (!record) {
      throw new NotFoundError("Content not found");
    }

    const user = await this.deps.userRepository.findById(record.createdById);
    const thumbnailUrl = await this.buildThumbnailUrl(record);
    return toContentView(record, user?.name ?? null, { thumbnailUrl });
  }
}
