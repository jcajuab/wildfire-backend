import { createHmac, timingSafeEqual } from "node:crypto";
import { type DisplayKeyRepository } from "#/application/ports/display-auth";
import { type DisplayRepository } from "#/application/ports/displays";
import {
  fromBase64Url,
  toBase64Url,
  verifyEd25519Signature,
} from "./display-crypto";
import { DisplayAuthenticationError, NotFoundError } from "./errors";

const MAX_TOKEN_SEGMENTS = 2;
const MAX_TOKEN_SEGMENT_BYTES = 2_048;
const MAX_DISPLAY_TOKEN_FIELD_BYTES = 256;
const MAX_KEY_ID_BYTES = 64;
const MAX_SIGNED_SIGNATURE_BYTES = 2_048;

const isString = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= maxBytes;

const signChallengeToken = (payload: string, secret: string): string =>
  toBase64Url(createHmac("sha256", secret).update(payload).digest());

const safeCompare = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

const buildChallengeSigningPayload = (input: {
  challengeToken: string;
  slug: string;
  keyId: string;
}): string =>
  ["CHALLENGE", input.challengeToken, input.slug, input.keyId].join("\n");

const parseChallengeToken = (input: {
  token: string;
  secret: string;
  now: Date;
}): {
  challengeId: string;
  slug: string;
  keyId: string;
  challengeNonce: string;
  expiresAt: string;
} | null => {
  const tokenParts = input.token.split(".");
  if (
    tokenParts.length !== MAX_TOKEN_SEGMENTS ||
    tokenParts[0] == null ||
    tokenParts[1] == null
  ) {
    return null;
  }

  const [encodedPayload, signature] = tokenParts;
  if (
    encodedPayload.length === 0 ||
    signature.length === 0 ||
    encodedPayload.length > MAX_TOKEN_SEGMENT_BYTES ||
    signature.length > MAX_SIGNED_SIGNATURE_BYTES
  ) {
    return null;
  }

  const expected = signChallengeToken(encodedPayload, input.secret);
  if (!safeCompare(expected, signature)) {
    return null;
  }

  try {
    const payloadBytes = fromBase64Url(encodedPayload);
    if (payloadBytes.length > MAX_DISPLAY_TOKEN_FIELD_BYTES) {
      return null;
    }

    const payload = JSON.parse(payloadBytes.toString("utf8")) as {
      id?: string;
      s?: string;
      k?: string;
      n?: string;
      e?: string;
    };

    if (
      !isString(payload.id, MAX_DISPLAY_TOKEN_FIELD_BYTES) ||
      !isString(payload.s, MAX_DISPLAY_TOKEN_FIELD_BYTES) ||
      !isString(payload.k, MAX_KEY_ID_BYTES) ||
      !isString(payload.n, MAX_DISPLAY_TOKEN_FIELD_BYTES) ||
      !isString(payload.e, MAX_DISPLAY_TOKEN_FIELD_BYTES)
    ) {
      return null;
    }

    const expiresMs = Date.parse(payload.e);
    if (!Number.isFinite(expiresMs) || expiresMs <= input.now.getTime()) {
      return null;
    }

    return {
      challengeId: payload.id,
      slug: payload.s,
      keyId: payload.k,
      challengeNonce: payload.n,
      expiresAt: payload.e,
    };
  } catch {
    return null;
  }
};

export class VerifyDisplayAuthChallengeUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayKeyRepository: DisplayKeyRepository;
      jwtSecret: string;
    },
  ) {}

  async execute(input: {
    challengeToken: string;
    slug: string;
    keyId: string;
    signature: string;
    now?: Date;
  }): Promise<void> {
    const challenge = parseChallengeToken({
      token: input.challengeToken,
      secret: this.deps.jwtSecret,
      now: input.now ?? new Date(),
    });
    if (!challenge) {
      throw new DisplayAuthenticationError("Invalid challenge token");
    }

    if (challenge.slug !== input.slug || challenge.keyId !== input.keyId) {
      throw new DisplayAuthenticationError("Challenge context mismatch");
    }

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

    const signingPayload = buildChallengeSigningPayload({
      challengeToken: input.challengeToken,
      slug: input.slug,
      keyId: input.keyId,
    });
    const valid = verifyEd25519Signature({
      publicKeyPem: key.publicKey,
      payload: signingPayload,
      signatureBase64Url: input.signature,
    });
    if (!valid) {
      throw new DisplayAuthenticationError("Challenge signature is invalid");
    }
  }
}
