import { type DisplayAuthNonceRepository } from "#/application/ports/display-auth";
import { env } from "#/env";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";
import { toUnixSeconds } from "#/infrastructure/redis/utils";

const noncePrefix = `${env.REDIS_KEY_PREFIX}:display-auth-nonce`;

const nonceKey = (displayId: string, nonce: string): string =>
  `${noncePrefix}:${displayId}:${nonce}`;

export class DisplayAuthNonceRedisRepository
  implements DisplayAuthNonceRepository
{
  async consumeUnique(input: {
    displayId: string;
    nonce: string;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean> {
    const redis = await getRedisCommandClient();
    const result = await executeRedisCommand<string>(redis, [
      "SET",
      nonceKey(input.displayId, input.nonce),
      "1",
      "NX",
      "EXAT",
      toUnixSeconds(input.expiresAt),
    ]);

    return String(result) === "OK";
  }
}
