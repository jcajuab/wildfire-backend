export { NotFoundError } from "#/application/errors/not-found";

import { AppError } from "#/application/errors/app-error";

export class InvalidContentTypeError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "invalid_content_type",
      httpStatus: 422,
    });
  }
}

export class ContentInUseError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "content_in_use",
      httpStatus: 409,
    });
  }
}

export class ContentStorageCleanupError extends AppError {
  constructor(
    message: string,
    public readonly context: { contentId: string; fileKey: string },
    options?: ErrorOptions,
  ) {
    super(message, {
      ...options,
      code: "content_storage_cleanup_failed",
      httpStatus: 500,
      details: context,
    });
  }
}

export class ContentMetadataExtractionError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "content_metadata_extraction_failed",
      httpStatus: 500,
    });
  }
}
