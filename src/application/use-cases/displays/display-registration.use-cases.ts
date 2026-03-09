import {
  createHash,
  createPublicKey,
  randomInt,
  randomUUID,
  verify,
} from "node:crypto";
import { ValidationError } from "#/application/errors/validation";
import {
  type DisplayKeyRepository,
  type DisplayPairingSessionRepository,
} from "#/application/ports/display-auth";
import {
  DisplayPairingCodeCollisionError,
  type DisplayPairingCodeRepository,
} from "#/application/ports/display-pairing";
import {
  type DisplayRegistrationAttemptEventPublisher,
  type DisplayRegistrationAttemptStore,
} from "#/application/ports/display-registration-attempt";
import { type AdminDisplayLifecycleEventPublisher } from "#/application/ports/display-stream-events";
import {
  type DisplayPreviewRepository,
  type DisplayRepository,
} from "#/application/ports/displays";
import { DisplayRegistrationConflictError, NotFoundError } from "./errors";

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const DISPLAY_REGISTRATION_SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const DISPLAY_REGISTRATION_SLUG_REGEX = new RegExp(
  DISPLAY_REGISTRATION_SLUG_PATTERN,
);
const PREVIEW_STALE_AFTER_MS = 30_000;

export const DISPLAY_REGISTRATION_CONSTRAINTS = {
  slugPattern: DISPLAY_REGISTRATION_SLUG_PATTERN,
  minSlugLength: 3,
  maxSlugLength: 120,
} as const;

const hashPairingCode = (code: string): string =>
  createHash("sha256").update(code).digest("hex");

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

const buildRegistrationPayload = (input: {
  registrationSessionId: string;
  challengeNonce: string;
  slug: string;
  output: string;
  fingerprint: string;
  publicKey: string;
}): string =>
  [
    "REGISTRATION",
    input.registrationSessionId,
    input.challengeNonce,
    input.slug,
    input.output,
    input.fingerprint,
    input.publicKey,
  ].join("\n");

const isDuplicateIndexError = (error: unknown, indexName: string): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const dbError = error as {
    code?: string;
    message?: string;
    sqlMessage?: string;
  };
  const details = [dbError.message, dbError.sqlMessage]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return (
    dbError.code === "ER_DUP_ENTRY" && details.includes(indexName.toLowerCase())
  );
};

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

const issuePairingCode = async (input: {
  displayPairingCodeRepository: DisplayPairingCodeRepository;
  ownerId: string;
  now: Date;
}): Promise<{
  code: string;
  codeHash: string;
  pairingCodeId: string;
  expiresAt: Date;
}> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(input.now.getTime() + PAIRING_CODE_TTL_MS);
    const codeHash = hashPairingCode(code);

    try {
      const created = await input.displayPairingCodeRepository.create({
        codeHash,
        expiresAt,
        ownerId: input.ownerId,
      });
      return {
        code,
        codeHash,
        pairingCodeId: created.id,
        expiresAt,
      };
    } catch (error) {
      if (!(error instanceof DisplayPairingCodeCollisionError)) {
        throw error;
      }
    }
  }

  throw new Error("Failed to generate a unique pairing code");
};

export class IssueDisplayRegistrationAttemptUseCase {
  constructor(
    private readonly deps: {
      displayPairingCodeRepository: DisplayPairingCodeRepository;
      registrationAttemptStore: DisplayRegistrationAttemptStore;
    },
  ) {}

  async execute(input: { ownerId: string; now?: Date }) {
    const now = input.now ?? new Date();
    const issued = await issuePairingCode({
      displayPairingCodeRepository: this.deps.displayPairingCodeRepository,
      ownerId: input.ownerId,
      now,
    });

    const created =
      await this.deps.registrationAttemptStore.createOrReplaceOpenAttempt({
        ownerId: input.ownerId,
        activeCode: {
          code: issued.code,
          codeHash: issued.codeHash,
          pairingCodeId: issued.pairingCodeId,
          expiresAt: issued.expiresAt,
        },
      });

    if (created.invalidatedPairingCodeId) {
      await this.deps.displayPairingCodeRepository.invalidateById({
        id: created.invalidatedPairingCodeId,
        now,
      });
    }

    return {
      attemptId: created.attemptId,
      code: issued.code,
      expiresAt: issued.expiresAt.toISOString(),
    };
  }
}

export class RotateDisplayRegistrationAttemptUseCase {
  constructor(
    private readonly deps: {
      displayPairingCodeRepository: DisplayPairingCodeRepository;
      registrationAttemptStore: DisplayRegistrationAttemptStore;
    },
  ) {}

  async execute(input: { attemptId: string; ownerId: string; now?: Date }) {
    const now = input.now ?? new Date();
    const issued = await issuePairingCode({
      displayPairingCodeRepository: this.deps.displayPairingCodeRepository,
      ownerId: input.ownerId,
      now,
    });

    const rotated = await this.deps.registrationAttemptStore.rotateCode({
      attemptId: input.attemptId,
      ownerId: input.ownerId,
      nextCode: {
        code: issued.code,
        codeHash: issued.codeHash,
        pairingCodeId: issued.pairingCodeId,
        expiresAt: issued.expiresAt,
      },
    });
    if (!rotated) {
      throw new NotFoundError("Registration attempt not found");
    }

    if (rotated.invalidatedPairingCodeId) {
      await this.deps.displayPairingCodeRepository.invalidateById({
        id: rotated.invalidatedPairingCodeId,
        now,
      });
    }

    return {
      code: issued.code,
      expiresAt: issued.expiresAt.toISOString(),
    };
  }
}

export class CloseDisplayRegistrationAttemptUseCase {
  constructor(
    private readonly deps: {
      displayPairingCodeRepository: DisplayPairingCodeRepository;
      registrationAttemptStore: DisplayRegistrationAttemptStore;
    },
  ) {}

  async execute(input: {
    attemptId: string;
    ownerId: string;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    const closed = await this.deps.registrationAttemptStore.closeAttempt({
      attemptId: input.attemptId,
      ownerId: input.ownerId,
    });
    if (!closed) {
      throw new NotFoundError("Registration attempt not found");
    }

    if (closed.invalidatedPairingCodeId) {
      await this.deps.displayPairingCodeRepository.invalidateById({
        id: closed.invalidatedPairingCodeId,
        now,
      });
    }
  }
}

export class CreateDisplayRegistrationSessionUseCase {
  constructor(
    private readonly deps: {
      displayPairingCodeRepository: DisplayPairingCodeRepository;
      displayPairingSessionRepository: DisplayPairingSessionRepository;
      registrationAttemptStore: DisplayRegistrationAttemptStore;
    },
  ) {}

  async execute(input: { registrationCode: string; now?: Date }) {
    const now = input.now ?? new Date();
    const codeHash = hashPairingCode(input.registrationCode);
    const consumedAttempt =
      await this.deps.registrationAttemptStore.consumeCodeHash({
        codeHash,
        now,
      });
    if (!consumedAttempt) {
      throw new ValidationError(
        "Registration code is invalid, expired, or already used",
      );
    }

    const consumed =
      await this.deps.displayPairingCodeRepository.consumeValidCode({
        codeHash,
        now,
      });
    if (!consumed || consumed.id !== consumedAttempt.pairingCodeId) {
      throw new ValidationError(
        "Registration code is invalid, expired, or already used",
      );
    }

    const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
    const session = await this.deps.displayPairingSessionRepository.create({
      pairingCodeId: consumed.id,
      challengeNonce: randomUUID(),
      challengeExpiresAt: expiresAt,
    });

    await this.deps.registrationAttemptStore.bindSessionAttempt({
      sessionId: session.id,
      attemptId: consumedAttempt.attemptId,
    });

    return {
      registrationSessionId: session.id,
      expiresAt: session.challengeExpiresAt,
      challengeNonce: session.challengeNonce,
    };
  }
}

export class RegisterDisplayUseCase {
  constructor(
    private readonly deps: {
      displayPairingSessionRepository: DisplayPairingSessionRepository;
      displayRepository: DisplayRepository;
      displayKeyRepository: DisplayKeyRepository;
      registrationAttemptStore: DisplayRegistrationAttemptStore;
      registrationAttemptEventPublisher: DisplayRegistrationAttemptEventPublisher;
      lifecycleEventPublisher: AdminDisplayLifecycleEventPublisher;
    },
  ) {}

  async execute(input: {
    registrationSessionId: string;
    slug: string;
    displayName: string;
    resolutionWidth: number;
    resolutionHeight: number;
    output: string;
    fingerprint: string;
    publicKey: string;
    registrationSignature: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const session =
      await this.deps.displayPairingSessionRepository.findOpenById({
        id: input.registrationSessionId,
        now,
      });
    if (!session) {
      throw new ValidationError("Registration session is invalid or expired");
    }

    if (
      input.slug.trim().length === 0 ||
      input.slug.length < DISPLAY_REGISTRATION_CONSTRAINTS.minSlugLength ||
      input.slug.length > DISPLAY_REGISTRATION_CONSTRAINTS.maxSlugLength ||
      !DISPLAY_REGISTRATION_SLUG_REGEX.test(input.slug)
    ) {
      throw new ValidationError("Display slug is invalid");
    }

    const registrationPayload = buildRegistrationPayload({
      registrationSessionId: session.id,
      challengeNonce: session.challengeNonce,
      slug: input.slug,
      output: input.output,
      fingerprint: input.fingerprint,
      publicKey: input.publicKey,
    });

    const isRegistrationSignatureValid = verifyEd25519Signature({
      publicKeyPem: input.publicKey,
      payload: registrationPayload,
      signatureBase64Url: input.registrationSignature,
    });
    if (!isRegistrationSignatureValid) {
      throw new ValidationError("Registration signature is invalid");
    }

    const normalizedOutput = input.output.trim().toLowerCase();
    if (normalizedOutput.length === 0) {
      throw new ValidationError("Display output is required");
    }

    const [existingSlug, existingFingerprintOutput] = await Promise.all([
      this.deps.displayRepository.findBySlug(input.slug),
      this.deps.displayRepository.findByFingerprintAndOutput(
        input.fingerprint,
        normalizedOutput,
      ),
    ]);

    if (existingSlug || existingFingerprintOutput) {
      throw new DisplayRegistrationConflictError(
        "Display slug or fingerprint/output already exists",
      );
    }

    const consumedSession =
      await this.deps.displayPairingSessionRepository.complete(session.id, now);
    if (!consumedSession) {
      throw new ValidationError("Registration session is invalid or expired");
    }

    let registered: {
      displayId: string;
      slug: string;
      keyId: string;
      state: "registered";
    } | null = null;

    try {
      const createdDisplay =
        await this.deps.displayRepository.createRegisteredDisplay({
          slug: input.slug,
          name: input.displayName,
          fingerprint: input.fingerprint,
          output: normalizedOutput,
          screenWidth: input.resolutionWidth,
          screenHeight: input.resolutionHeight,
          now,
        });

      let createdKey: { id: string } | null = null;
      try {
        createdKey = await this.deps.displayKeyRepository.create({
          displayId: createdDisplay.id,
          algorithm: "ed25519",
          publicKey: input.publicKey,
        });
      } catch (error) {
        await this.deps.displayRepository.delete(createdDisplay.id);
        throw error;
      }

      if (!createdKey) {
        throw new Error("Display key creation failed");
      }

      registered = {
        displayId: createdDisplay.id,
        slug: createdDisplay.slug,
        keyId: createdKey.id,
        state: "registered",
      };
    } catch (error) {
      if (
        isDuplicateIndexError(error, "displays_slug_unique") ||
        isDuplicateIndexError(error, "displays_fingerprint_output_unique") ||
        isDuplicateIndexError(error, "display_keys_display_id_unique")
      ) {
        throw new DisplayRegistrationConflictError(
          "Display slug, fingerprint/output, or key already exists",
        );
      }

      throw error;
    }

    if (!registered) {
      throw new Error("Display registration did not produce a result");
    }

    const attemptId =
      await this.deps.registrationAttemptStore.consumeSessionAttemptId(
        input.registrationSessionId,
      );
    if (attemptId) {
      this.deps.registrationAttemptEventPublisher.publish({
        type: "registration_succeeded",
        attemptId,
        displayId: registered.displayId,
        slug: registered.slug,
        occurredAt: now.toISOString(),
      });
    }

    this.deps.lifecycleEventPublisher.publish({
      type: "display_registered",
      displayId: registered.displayId,
      slug: registered.slug,
      occurredAt: now.toISOString(),
    });

    return registered;
  }
}

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
