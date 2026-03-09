import { ValidationError } from "#/application/errors/validation";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type UserRepository } from "#/application/ports/rbac";
import { sha256Hex } from "#/domain/content/checksum";
import { toContentView } from "./content-view";

const createFlashFileKey = (contentId: string): string =>
  `content/flash/${contentId}.txt`;

const normalizeFlashMessage = (value: string): string => value.trim();

const buildFlashChecksum = async (input: {
  message: string;
  tone: "INFO" | "WARNING" | "CRITICAL";
}): Promise<string> => {
  const payload = JSON.stringify(input);
  return sha256Hex(new TextEncoder().encode(payload).buffer);
};

export class CreateFlashContentUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      contentStorage: ContentStorage;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: {
    title: string;
    message: string;
    tone: "INFO" | "WARNING" | "CRITICAL";
    ownerId: string;
  }) {
    const title = input.title.trim();
    const message = normalizeFlashMessage(input.message);
    if (title.length === 0) {
      throw new ValidationError("Title is required");
    }
    if (message.length === 0 || message.length > 240) {
      throw new ValidationError(
        "Flash message must be between 1 and 240 characters",
      );
    }

    const id = crypto.randomUUID();
    const body = new TextEncoder().encode(message);
    const checksum = await buildFlashChecksum({
      message,
      tone: input.tone,
    });
    const fileKey = createFlashFileKey(id);

    await this.deps.contentStorage.upload({
      key: fileKey,
      body,
      contentType: "text/plain; charset=utf-8",
      contentLength: body.byteLength,
    });

    await this.deps.contentRepository.create({
      id,
      title,
      type: "FLASH",
      kind: "ROOT",
      status: "READY",
      fileKey,
      thumbnailKey: null,
      parentContentId: null,
      pageNumber: null,
      pageCount: null,
      isExcluded: false,
      checksum,
      mimeType: "text/plain",
      fileSize: body.byteLength,
      width: null,
      height: null,
      duration: null,
      scrollPxPerSecond: null,
      flashMessage: message,
      flashTone: input.tone,
      ownerId: input.ownerId,
    });

    const content = await this.deps.contentRepository.findById(id);
    if (!content) {
      throw new Error("Flash content was created but could not be loaded");
    }
    const user = await this.deps.userRepository.findById(content.ownerId);
    return toContentView(content, user?.name ?? null);
  }
}
