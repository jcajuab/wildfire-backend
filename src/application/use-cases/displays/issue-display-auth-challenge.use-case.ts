import { createHmac, randomUUID } from "node:crypto";
import { type DisplayKeyRepository } from "#/application/ports/display-auth";
import { type DisplayRepository } from "#/application/ports/displays";
import { toBase64Url } from "./display-crypto";
import { DisplayAuthenticationError, NotFoundError } from "./errors";

const CHALLENGE_TTL_MS = 2 * 60 * 1000;

const signChallengeToken = (payload: string, secret: string): string =>
  toBase64Url(createHmac("sha256", secret).update(payload).digest());

const buildChallengeToken = (input: {
  challengeId: string;
  slug: string;
  keyId: string;
  challengeNonce: string;
  expiresAt: Date;
  secret: string;
}): string => {
  const payload = JSON.stringify({
    id: input.challengeId,
    s: input.slug,
    k: input.keyId,
    n: input.challengeNonce,
    e: input.expiresAt.toISOString(),
  });
  const encoded = toBase64Url(payload);
  const signature = signChallengeToken(encoded, input.secret);
  return `${encoded}.${signature}`;
};

export class IssueDisplayAuthChallengeUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayKeyRepository: DisplayKeyRepository;
      jwtSecret: string;
    },
  ) {}

  async execute(input: { slug: string; keyId: string; now?: Date }) {
    const display = await this.deps.displayRepository.findBySlug(input.slug);
    if (!display) {
      throw new NotFoundError("Display not found");
    }

    const key = await this.deps.displayKeyRepository.findActiveByKeyId(
      input.keyId,
    );
    if (!key || key.displayId !== display.id) {
      throw new DisplayAuthenticationError("Display key is invalid");
    }

    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    const challengeToken = buildChallengeToken({
      challengeId: randomUUID(),
      challengeNonce: randomUUID(),
      slug: input.slug,
      keyId: input.keyId,
      expiresAt,
      secret: this.deps.jwtSecret,
    });

    return {
      challengeToken,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
