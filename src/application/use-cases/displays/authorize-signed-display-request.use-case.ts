import { createHash, createPublicKey, verify } from "node:crypto";
import { AppError } from "#/application/errors/app-error";
import {
  type DisplayAuthNonceRepository,
  type DisplayKeyRepository,
} from "#/application/ports/display-auth";
import { type DisplayRepository } from "#/application/ports/displays";
import { NotFoundError } from "./errors";

const SIGNED_REQUEST_SKEW_MS = 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;

class DisplayAuthenticationError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "display_authentication_failed",
      httpStatus: 401,
    });
  }
}

const fromBase64Url = (value: string): Buffer => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, "base64");
};

const verifyEd25519Signature = (input: {
  publicKeyPem: string;
  payload: string;
  signatureBase64Url: string;
}): boolean => {
  try {
    const keyObject = createPublicKey(input.publicKeyPem);
    const signature = fromBase64Url(input.signatureBase64Url);
    return verify(
      null,
      Buffer.from(input.payload, "utf8"),
      keyObject,
      signature,
    );
  } catch {
    return false;
  }
};

const buildSignedRequestPayload = (input: {
  method: string;
  pathWithQuery: string;
  slug: string;
  keyId: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
}): string =>
  [
    input.method,
    input.pathWithQuery,
    input.slug,
    input.keyId,
    input.timestamp,
    input.nonce,
    input.bodyHash,
  ].join("\n");

export class AuthorizeSignedDisplayRequestUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayKeyRepository: DisplayKeyRepository;
      displayAuthNonceRepository: DisplayAuthNonceRepository;
    },
  ) {}

  async execute(input: {
    method: string;
    pathWithQuery: string;
    slug: string;
    keyId: string;
    timestamp: string;
    nonce: string;
    signature: string;
    bodyHash: string;
    now?: Date;
  }): Promise<{ displayId: string }> {
    const now = input.now ?? new Date();
    const timestampMs = Date.parse(input.timestamp);
    if (!Number.isFinite(timestampMs)) {
      throw new DisplayAuthenticationError("Invalid signed request timestamp");
    }
    if (Math.abs(now.getTime() - timestampMs) > SIGNED_REQUEST_SKEW_MS) {
      throw new DisplayAuthenticationError(
        "Signed request timestamp out of bounds",
      );
    }

    const display = await this.deps.displayRepository.findBySlug(input.slug);
    if (!display) {
      throw new NotFoundError("Display not found");
    }

    const activeKey = await this.deps.displayKeyRepository.findActiveByKeyId(
      input.keyId,
    );
    if (!activeKey || activeKey.displayId !== display.id) {
      throw new DisplayAuthenticationError("Invalid display key");
    }

    const nonceAllowed =
      await this.deps.displayAuthNonceRepository.consumeUnique({
        displayId: display.id,
        nonce: input.nonce,
        now,
        expiresAt: new Date(now.getTime() + NONCE_TTL_MS),
      });
    if (!nonceAllowed) {
      throw new DisplayAuthenticationError("Request nonce replay detected");
    }

    const payload = buildSignedRequestPayload({
      method: input.method,
      pathWithQuery: input.pathWithQuery,
      slug: input.slug,
      keyId: input.keyId,
      timestamp: input.timestamp,
      nonce: input.nonce,
      bodyHash: input.bodyHash,
    });

    const isValidSignature = verifyEd25519Signature({
      publicKeyPem: activeKey.publicKey,
      payload,
      signatureBase64Url: input.signature,
    });
    if (!isValidSignature) {
      throw new DisplayAuthenticationError("Invalid signed request signature");
    }

    return { displayId: display.id };
  }
}

export const toSignedRequestBodyHash = (body: string): string =>
  createHash("sha256").update(body).digest("base64url");
