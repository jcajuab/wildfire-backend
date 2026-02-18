import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { resolveFileExtension } from "#/domain/content/content";
import { NotFoundError } from "./errors";

const toSafeFilename = (value: string): string =>
  value
    .trim()
    .replace(/[^\w\-.\s]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 120);

export class GetContentDownloadUrlUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      contentStorage: ContentStorage;
      expiresInSeconds: number;
    },
  ) {}

  async execute(input: { id: string }) {
    const record = await this.deps.contentRepository.findById(input.id);
    if (!record) {
      throw new NotFoundError("Content not found");
    }

    const extension = resolveFileExtension(record.mimeType) ?? "bin";
    const baseName = toSafeFilename(record.title) || "content";
    const filename = `${baseName}.${extension}`;
    const downloadUrl = await this.deps.contentStorage.getPresignedDownloadUrl({
      key: record.fileKey,
      expiresInSeconds: this.deps.expiresInSeconds,
      responseContentDisposition: `attachment; filename="${filename}"`,
    });

    return { downloadUrl };
  }
}
