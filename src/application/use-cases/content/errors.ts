export { NotFoundError } from "#/application/errors/not-found";

export class InvalidContentTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidContentTypeError";
  }
}

export class ContentInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentInUseError";
  }
}

export class ContentStorageCleanupError extends Error {
  constructor(
    message: string,
    public readonly context: { contentId: string; fileKey: string },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ContentStorageCleanupError";
  }
}

export class ContentMetadataExtractionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ContentMetadataExtractionError";
  }
}
