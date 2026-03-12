import {
  type DisplayPreviewRepository,
  type DisplayRepository,
} from "#/application/ports/displays";
import { NotFoundError } from "./errors";

const PREVIEW_STALE_AFTER_MS = 30_000;

const parseImageDataUrl = (
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
    if (bytes.length === 0) {
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

export class GetDisplayPreviewUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayPreviewRepository: DisplayPreviewRepository;
    },
  ) {}

  async execute(input: { id: string; now?: Date }) {
    const display = await this.deps.displayRepository.findById(input.id);
    if (!display) {
      throw new NotFoundError("Display not found");
    }

    const preview =
      await this.deps.displayPreviewRepository.findLatestByDisplayId(
        display.id,
      );
    if (!preview) {
      return null;
    }

    const now = input.now ?? new Date();
    const capturedAtMs = Date.parse(preview.capturedAt);
    if (
      !Number.isFinite(capturedAtMs) ||
      now.getTime() - capturedAtMs > PREVIEW_STALE_AFTER_MS
    ) {
      return null;
    }

    const parsed = parseImageDataUrl(preview.imageDataUrl);
    if (!parsed) {
      return null;
    }

    return {
      bytes: new Uint8Array(parsed.bytes),
      mimeType: parsed.mimeType,
      lastModified: new Date(capturedAtMs).toUTCString(),
    };
  }
}
