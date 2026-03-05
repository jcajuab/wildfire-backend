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

export interface FlashActivationConflictDetails {
  active: {
    id: string;
    contentId: string;
    targetDisplayId: string;
    message: string;
    tone: "INFO" | "WARNING" | "CRITICAL";
    status: "ACTIVE" | "STOPPED" | "EXPIRED";
    startedAt: string;
    endsAt: string;
    stoppedAt: string | null;
    stoppedReason: string | null;
    createdById: string;
    createdAt: string;
    updatedAt: string;
    replacementCount: number;
  };
  pending: {
    message: string;
    targetDisplayId: string;
    durationSeconds: number;
    tone: "INFO" | "WARNING" | "CRITICAL";
  };
}

export class FlashActivationConflictError extends Error {
  constructor(
    message: string,
    public readonly details: FlashActivationConflictDetails,
  ) {
    super(message);
    this.name = "FlashActivationConflictError";
  }
}
