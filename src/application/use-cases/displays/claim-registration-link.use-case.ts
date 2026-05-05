import { ValidationError } from "#/application/errors/validation";
import { type DisplayKeyRepository } from "#/application/ports/display-auth";
import {
  type DisplayRegistrationAttemptEventPublisher,
  type DisplayRegistrationAttemptStore,
} from "#/application/ports/display-registration-attempt";
import { type DisplayRegistrationLinkStore } from "#/application/ports/display-registration-link";
import { type AdminDisplayLifecycleEventPublisher } from "#/application/ports/display-stream-events";
import {
  type DisplayGroupRepository,
  type DisplayRepository,
} from "#/application/ports/displays";
import { verifyEd25519Signature } from "./display-crypto";
import { DisplayRegistrationConflictError } from "./errors";

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

export class ClaimRegistrationLinkUseCase {
  constructor(
    private readonly deps: {
      registrationLinkStore: DisplayRegistrationLinkStore;
      displayRepository: DisplayRepository;
      displayKeyRepository: DisplayKeyRepository;
      displayGroupRepository: DisplayGroupRepository;
      registrationAttemptStore: DisplayRegistrationAttemptStore;
      registrationAttemptEventPublisher: DisplayRegistrationAttemptEventPublisher;
      lifecycleEventPublisher: AdminDisplayLifecycleEventPublisher;
    },
  ) {}

  async execute(input: {
    token: string;
    fingerprint: string;
    publicKey: string;
    keyAlgorithm: "ed25519";
    registrationSignature: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();

    const linkRecord = await this.deps.registrationLinkStore.consume(
      input.token,
      now,
    );
    if (!linkRecord) {
      throw new ValidationError(
        "Registration link is invalid, expired, or already used",
      );
    }

    const registrationPayload = [
      "REGISTRATION",
      input.token,
      linkRecord.challengeNonce,
      linkRecord.slug,
      linkRecord.output,
      input.fingerprint,
      input.publicKey,
    ].join("\n");

    const isSignatureValid = verifyEd25519Signature({
      publicKeyPem: input.publicKey,
      payload: registrationPayload,
      signatureBase64Url: input.registrationSignature,
    });
    if (!isSignatureValid) {
      throw new ValidationError("Registration signature is invalid");
    }

    const normalizedOutput = linkRecord.output.trim().toLowerCase();

    const [existingSlug, existingFingerprintOutput] = await Promise.all([
      this.deps.displayRepository.findBySlug(linkRecord.slug),
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

    let registered: {
      displayId: string;
      slug: string;
      keyId: string;
      state: "registered";
    } | null = null;

    try {
      const createdDisplay =
        await this.deps.displayRepository.createRegisteredDisplay({
          slug: linkRecord.slug,
          name: linkRecord.displayName,
          fingerprint: input.fingerprint,
          output: normalizedOutput,
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

    // Assign display groups server-side
    if (linkRecord.displayGroups.length > 0) {
      try {
        const groupIds: string[] = [];
        for (const groupName of linkRecord.displayGroups) {
          const normalizedName = groupName.trim();
          if (!normalizedName) continue;

          const existing =
            await this.deps.displayGroupRepository.findByName(normalizedName);
          if (existing) {
            groupIds.push(existing.id);
          } else {
            const created = await this.deps.displayGroupRepository.create({
              name: normalizedName,
            });
            groupIds.push(created.id);
          }
        }

        if (groupIds.length > 0) {
          await this.deps.displayGroupRepository.setDisplayGroups(
            registered.displayId,
            groupIds,
          );
        }
      } catch {
        // Group assignment failed but display was registered.
        // Continue — groups can be assigned manually later.
      }
    }

    // Publish SSE event to notify the admin dashboard
    const attemptId =
      await this.deps.registrationAttemptStore.consumeSessionAttemptId(
        input.token,
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
