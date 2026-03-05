import { type PasswordResetTokenRepository } from "#/application/ports/auth";
import { env } from "#/env";
import { getRedisCommandClient } from "#/infrastructure/redis/client";

const tokenPrefix = `${env.REDIS_KEY_PREFIX}:password-reset-token`;

const tokenKey = (hashedToken: string): string =>
  `${tokenPrefix}:${hashedToken}`;
const toUnixSeconds = (value: Date): string =>
  String(Math.max(1, Math.ceil(value.getTime() / 1000)));

export class PasswordResetTokenRedisRepository
  implements PasswordResetTokenRepository
{
  async store(input: {
    hashedToken: string;
    email: string;
    expiresAt: Date;
  }): Promise<void> {
    const redis = await getRedisCommandClient();
    await redis.sendCommand([
      "SET",
      tokenKey(input.hashedToken),
      input.email,
      "EXAT",
      toUnixSeconds(input.expiresAt),
    ]);
  }

  async findByHashedToken(
    hashedToken: string,
    _now: Date,
  ): Promise<{ email: string } | null> {
    const redis = await getRedisCommandClient();
    const email = await redis.get(tokenKey(hashedToken));
    if (!email) {
      return null;
    }

    return { email };
  }

  async consumeByHashedToken(hashedToken: string): Promise<void> {
    const redis = await getRedisCommandClient();
    await redis.del(tokenKey(hashedToken));
  }

  async deleteExpired(_now: Date): Promise<void> {
    return;
  }
}
