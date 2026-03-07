import {
  createHash,
  createHmac,
  createPublicKey,
  randomUUID,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { AppError } from "#/application/errors/app-error";
import {
  type DisplayAuthNonceRepository,
  type DisplayKeyRepository,
} from "#/application/ports/display-auth";
import {
  type AdminDisplayLifecycleEventPublisher,
  type DisplayStreamEventPublisher,
} from "#/application/ports/display-stream-events";
import {
  type DisplayPreviewRepository,
  type DisplayRepository,
} from "#/application/ports/displays";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { selectActiveScheduleByKind } from "#/domain/schedules/schedule";
import { deriveDisplayStatus } from "./display.use-cases";
import { NotFoundError } from "./errors";

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const SIGNED_REQUEST_SKEW_MS = 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_TOKEN_SEGMENTS = 2;
const MAX_TOKEN_SEGMENT_BYTES = 2_048;
const MAX_DISPLAY_TOKEN_FIELD_BYTES = 256;
const MAX_KEY_ID_BYTES = 64;
const MAX_SIGNED_SIGNATURE_BYTES = 2_048;
const MAX_SNAPSHOT_IMAGE_BYTES = 400 * 1024;

const isString = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= maxBytes;

const toBase64Url = (value: string | Uint8Array): string =>
  Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");

const fromBase64Url = (value: string): Buffer => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, "base64");
};

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

class DisplayAuthenticationError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "display_authentication_failed",
      httpStatus: 401,
    });
  }
}

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

export class RecordDisplayHeartbeatUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      scheduleRepository: ScheduleRepository;
      displayEventPublisher: DisplayStreamEventPublisher;
      lifecycleEventPublisher: AdminDisplayLifecycleEventPublisher;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { displayId: string; now?: Date }): Promise<void> {
    const now = input.now ?? new Date();
    await this.deps.displayRepository.touchSeen(input.displayId, now);

    const [display, schedules] = await Promise.all([
      this.deps.displayRepository.findById(input.displayId),
      this.deps.scheduleRepository.listByDisplay(input.displayId),
    ]);

    if (display) {
      const activePlaylistSchedule = selectActiveScheduleByKind(
        schedules,
        "PLAYLIST",
        now,
        this.deps.scheduleTimeZone ?? "UTC",
      );
      const activeFlashSchedule = selectActiveScheduleByKind(
        schedules,
        "FLASH",
        now,
        this.deps.scheduleTimeZone ?? "UTC",
      );
      const nextStatus = deriveDisplayStatus({
        lastSeenAt: now.toISOString(),
        hasActivePlayback:
          activePlaylistSchedule !== null || activeFlashSchedule !== null,
        now,
      });

      if (display.status !== nextStatus) {
        await this.deps.displayRepository.setStatus({
          id: display.id,
          status: nextStatus,
          at: now,
        });
        this.deps.lifecycleEventPublisher.publish({
          type: "display_status_changed",
          displayId: display.id,
          slug: display.slug,
          previousStatus: display.status,
          status: nextStatus,
          occurredAt: now.toISOString(),
        });
      }
    }

    this.deps.displayEventPublisher.publish({
      type: "manifest_updated",
      displayId: input.displayId,
      reason: "heartbeat",
      timestamp: now.toISOString(),
    });
  }
}

export const toSignedRequestBodyHash = (body: string): string =>
  createHash("sha256").update(body).digest("base64url");
