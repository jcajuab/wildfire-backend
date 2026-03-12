import { AppError } from "#/application/errors/app-error";
import { type DisplayPreviewRepository } from "#/application/ports/displays";

const MAX_SNAPSHOT_IMAGE_BYTES = 400 * 1024;

const parseSnapshotImageDataUrl = (
  imageDataUrl: string,
): {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
} | null => {
  const match =
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/u.exec(
      imageDataUrl,
    );
  if (!match || !match[1] || !match[2]) {
    return null;
  }

  try {
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length === 0 || bytes.length > MAX_SNAPSHOT_IMAGE_BYTES) {
      return null;
    }

    return {
      mimeType: match[1],
      bytes,
    };
  } catch {
    return null;
  }
};

export class StoreDisplaySnapshotUseCase {
  constructor(
    private readonly deps: {
      displayPreviewRepository: DisplayPreviewRepository;
    },
  ) {}

  async execute(input: {
    displayId: string;
    imageDataUrl: string;
    capturedAt?: string;
  }): Promise<void> {
    const parsed = parseSnapshotImageDataUrl(input.imageDataUrl);
    if (!parsed) {
      throw new AppError("Snapshot image must be a valid data URL.", {
        code: "validation_error",
        httpStatus: 422,
      });
    }

    await this.deps.displayPreviewRepository.upsertLatest({
      displayId: input.displayId,
      imageDataUrl: input.imageDataUrl,
      capturedAt: input.capturedAt ?? new Date().toISOString(),
    });
  }
}
