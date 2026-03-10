import { ValidationError } from "#/application/errors/validation";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type UserRepository } from "#/application/ports/rbac";
import { sha256Hex } from "#/domain/content/checksum";
import { toContentView } from "./content-view";

const TEXT_CONTENT_MAX_CHARS = 5000;

const createTextFileKey = (contentId: string): string =>
  `content/text/${contentId}.json`;

const buildTextChecksum = async (input: {
  jsonContent: string;
  htmlContent: string;
}): Promise<string> => {
  const payload = JSON.stringify(input);
  return sha256Hex(new TextEncoder().encode(payload).buffer);
};

const countTextContentCharacters = (htmlContent: string): number => {
  // Strip HTML tags to count actual text characters
  const textOnly = htmlContent.replace(/<[^>]*>/g, "");
  return textOnly.length;
};

export class CreateTextContentUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      contentStorage: ContentStorage;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: {
    title: string;
    jsonContent: string;
    htmlContent: string;
    ownerId: string;
  }) {
    const title = input.title.trim();
    const jsonContent = input.jsonContent;
    const htmlContent = input.htmlContent;

    if (title.length === 0) {
      throw new ValidationError("Title is required");
    }

    const charCount = countTextContentCharacters(htmlContent);
    if (charCount === 0) {
      throw new ValidationError("Text content cannot be empty");
    }
    if (charCount > TEXT_CONTENT_MAX_CHARS) {
      throw new ValidationError(
        `Text content exceeds maximum of ${TEXT_CONTENT_MAX_CHARS} characters`,
      );
    }

    const id = crypto.randomUUID();
    const body = new TextEncoder().encode(jsonContent);
    const checksum = await buildTextChecksum({ jsonContent, htmlContent });
    const fileKey = createTextFileKey(id);

    await this.deps.contentStorage.upload({
      key: fileKey,
      body,
      contentType: "application/json; charset=utf-8",
      contentLength: body.byteLength,
    });

    await this.deps.contentRepository.create({
      id,
      title,
      type: "TEXT",
      kind: "ROOT",
      status: "READY",
      fileKey,
      thumbnailKey: null,
      parentContentId: null,
      pageNumber: null,
      pageCount: null,
      isExcluded: false,
      checksum,
      mimeType: "application/json",
      fileSize: body.byteLength,
      width: null,
      height: null,
      duration: null,
      scrollPxPerSecond: null,
      flashMessage: null,
      flashTone: null,
      textJsonContent: jsonContent,
      textHtmlContent: htmlContent,
      ownerId: input.ownerId,
    });

    const content = await this.deps.contentRepository.findById(id);
    if (!content) {
      throw new Error("Text content was created but could not be loaded");
    }
    const user = await this.deps.userRepository.findById(content.ownerId);
    return toContentView(content, user?.name ?? null);
  }
}
