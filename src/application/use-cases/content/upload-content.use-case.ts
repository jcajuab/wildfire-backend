import {
  type ContentRecord,
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type UserRepository } from "#/application/ports/rbac";
import { sha256Hex } from "#/domain/content/checksum";
import {
  buildContentFileKey,
  resolveContentType,
} from "#/domain/content/content";
import { toContentView } from "./content-view";
import { InvalidContentTypeError, NotFoundError } from "./errors";

export class UploadContentUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      contentStorage: ContentStorage;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: { title: string; file: File; createdById: string }) {
    const user = await this.deps.userRepository.findById(input.createdById);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const mimeType = input.file.type;
    const type = resolveContentType(mimeType);
    if (!type) {
      throw new InvalidContentTypeError("Unsupported content type");
    }

    const id = crypto.randomUUID();
    const fileKey = buildContentFileKey({ id, type, mimeType });
    const buffer = await input.file.arrayBuffer();
    const checksum = await sha256Hex(buffer);

    await this.deps.contentStorage.upload({
      key: fileKey,
      body: new Uint8Array(buffer),
      contentType: mimeType,
      contentLength: input.file.size,
    });

    let record: ContentRecord;
    try {
      record = await this.deps.contentRepository.create({
        id,
        title: input.title,
        type,
        status: "DRAFT",
        fileKey,
        checksum,
        mimeType,
        fileSize: input.file.size,
        width: null,
        height: null,
        duration: null,
        createdById: user.id,
      });
    } catch (error) {
      // Clean up orphan storage file if DB insert fails
      await this.deps.contentStorage.delete(fileKey).catch(() => {});
      throw error;
    }

    return toContentView(record, user.name);
  }
}
