import {
  type DisplayPreviewRecord,
  type DisplayPreviewRepository,
} from "#/application/ports/displays";
import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

const PREVIEW_TTL_SECONDS = 120;

const previewKey = (displayId: string): string =>
  `${env.REDIS_KEY_PREFIX}:display-preview:${displayId}`;

export class DisplayPreviewRedisRepository implements DisplayPreviewRepository {
  async upsertLatest(input: DisplayPreviewRecord): Promise<void> {
    const redis = await getRedisCommandClient();
    await executeRedisCommand(redis, [
      "SET",
      previewKey(input.displayId),
      JSON.stringify({
        displayId: input.displayId,
        imageDataUrl: input.imageDataUrl,
        capturedAt: input.capturedAt,
      }),
      "EX",
      String(PREVIEW_TTL_SECONDS),
    ]);
  }

  async findLatestByDisplayId(
    displayId: string,
  ): Promise<DisplayPreviewRecord | null> {
    const redis = await getRedisCommandClient();
    const raw = await executeRedisCommand<string | null>(redis, [
      "GET",
      previewKey(displayId),
    ]);
    if (typeof raw !== "string" || raw.length === 0) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as {
        displayId?: unknown;
        imageDataUrl?: unknown;
        capturedAt?: unknown;
      };
      if (
        typeof parsed.displayId !== "string" ||
        typeof parsed.imageDataUrl !== "string" ||
        typeof parsed.capturedAt !== "string"
      ) {
        return null;
      }

      return {
        displayId: parsed.displayId,
        imageDataUrl: parsed.imageDataUrl,
        capturedAt: parsed.capturedAt,
      };
    } catch {
      return null;
    }
  }
}
