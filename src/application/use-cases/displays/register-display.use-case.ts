import { createPublicKey, verify } from "node:crypto";
import { ValidationError } from "#/application/errors/validation";
import {
  type DisplayKeyRepository,
  type DisplayPairingSessionRepository,
} from "#/application/ports/display-auth";
import {
  type DisplayRegistrationAttemptEventPublisher,
  type DisplayRegistrationAttemptStore,
} from "#/application/ports/display-registration-attempt";
import { type AdminDisplayLifecycleEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { DisplayRegistrationConflictError } from "./errors";

const DISPLAY_REGISTRATION_SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const DISPLAY_REGISTRATION_SLUG_REGEX = new RegExp(
  DISPLAY_REGISTRATION_SLUG_PATTERN,
);

export const DISPLAY_REGISTRATION_CONSTRAINTS = {
  slugPattern: DISPLAY_REGISTRATION_SLUG_PATTERN,
  minSlugLength: 3,
  maxSlugLength: 120,
} as const;

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
