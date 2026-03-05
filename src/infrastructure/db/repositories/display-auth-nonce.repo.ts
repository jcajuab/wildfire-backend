import { type DisplayAuthNonceRepository } from "#/application/ports/display-auth";
import { env } from "#/env";
import { getRedisCommandClient } from "#/infrastructure/redis/client";

const noncePrefix = `${env.REDIS_KEY_PREFIX}:display-auth-nonce`;

const nonceKey = (displayId: string, nonce: string): string =>
  `${noncePrefix}:${displayId}:${nonce}`;
const toUnixSeconds = (value: Date): string =>
  String(Math.max(1, Math.ceil(value.getTime() / 1000)));

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
    const result = await redis.sendCommand([
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
