import {
  type PdfCropSession,
  type PdfCropSessionStore,
} from "#/application/ports/pdf-crop";
import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

const PDF_CROP_SESSION_TTL_SECONDS = 3600; // 1 hour
const sessionKey = (uploadId: string): string =>
  `${env.REDIS_KEY_PREFIX}:pdf-crop:${uploadId}`;

export class RedisPdfCropSessionStore implements PdfCropSessionStore {
  async save(session: PdfCropSession): Promise<void> {
    const redis = await getRedisCommandClient();
    await executeRedisCommand<string>(redis, [
      "SET",
      sessionKey(session.uploadId),
      JSON.stringify(session),
      "EX",
      String(PDF_CROP_SESSION_TTL_SECONDS),
    ]);
  }

  async findById(uploadId: string): Promise<PdfCropSession | null> {
    const redis = await getRedisCommandClient();
    const raw = await executeRedisCommand<string | null>(redis, [
      "GET",
      sessionKey(uploadId),
    ]);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as PdfCropSession;
    } catch {
      return null;
    }
  }

  async delete(uploadId: string): Promise<void> {
    const redis = await getRedisCommandClient();
    await executeRedisCommand<number>(redis, ["DEL", sessionKey(uploadId)]);
  }
}
