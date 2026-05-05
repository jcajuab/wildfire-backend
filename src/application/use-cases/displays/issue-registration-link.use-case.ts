import { randomUUID } from "node:crypto";
import { ValidationError } from "#/application/errors/validation";
import { type DisplayPairingCodeRepository } from "#/application/ports/display-pairing";
import { type DisplayRegistrationAttemptStore } from "#/application/ports/display-registration-attempt";
import { type DisplayRegistrationLinkStore } from "#/application/ports/display-registration-link";
import { type DisplayRepository } from "#/application/ports/displays";
import { DisplayRegistrationConflictError } from "./errors";
import { DISPLAY_REGISTRATION_CONSTRAINTS } from "./register-display.use-case";

const LINK_TTL_MS = 5 * 60 * 1_000;

const DISPLAY_REGISTRATION_SLUG_REGEX = new RegExp(
  DISPLAY_REGISTRATION_CONSTRAINTS.slugPattern,
);

export class IssueRegistrationLinkUseCase {
  constructor(
    private readonly deps: {
      registrationLinkStore: DisplayRegistrationLinkStore;
      registrationAttemptStore: DisplayRegistrationAttemptStore;
      displayPairingCodeRepository: DisplayPairingCodeRepository;
      displayRepository: DisplayRepository;
    },
  ) {}

  async execute(input: {
    ownerId: string;
    slug: string;
    displayName: string;
    outputType: string;
    outputIndex: number;
    resolutionWidth: number | null;
    resolutionHeight: number | null;
    displayGroups: string[];
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const slug = input.slug.trim().toLowerCase();
    const displayName = input.displayName.trim();

    if (!displayName || displayName.length === 0) {
      throw new ValidationError("Display name is required");
    }

    if (
      slug.length === 0 ||
      slug.length < DISPLAY_REGISTRATION_CONSTRAINTS.minSlugLength ||
      slug.length > DISPLAY_REGISTRATION_CONSTRAINTS.maxSlugLength ||
      !DISPLAY_REGISTRATION_SLUG_REGEX.test(slug)
    ) {
      throw new ValidationError("Display slug is invalid");
    }

    const output = `${input.outputType.toLowerCase()}-${String(input.outputIndex)}`;

    const existingSlug = await this.deps.displayRepository.findBySlug(slug);
    if (existingSlug) {
      throw new DisplayRegistrationConflictError(
        "A display with this slug already exists",
      );
    }

    const token = randomUUID();
    const challengeNonce = randomUUID();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS);

    // Create a registration attempt for SSE event tracking.
    // We need a pairing code to satisfy the attempt store contract,
    // but it won't be shown to the user in the link flow.
    const dummyCode = await this.issueDummyPairingCode(input.ownerId, now);

    const created =
      await this.deps.registrationAttemptStore.createOrReplaceOpenAttempt({
        ownerId: input.ownerId,
        activeCode: dummyCode,
      });

    if (created.invalidatedPairingCodeId) {
      await this.deps.displayPairingCodeRepository.invalidateById({
        id: created.invalidatedPairingCodeId,
        now,
      });
    }

    // Bind the token as a session key so consumeSessionAttemptId(token)
    // returns the attemptId during claim.
    await this.deps.registrationAttemptStore.bindSessionAttempt({
      sessionId: token,
      attemptId: created.attemptId,
    });

    await this.deps.registrationLinkStore.create({
      token,
      slug,
      displayName,
      output,
      resolutionWidth: input.resolutionWidth,
      resolutionHeight: input.resolutionHeight,
      displayGroups: input.displayGroups,
      challengeNonce,
      attemptId: created.attemptId,
      ownerId: input.ownerId,
      expiresAtMs: expiresAt.getTime(),
    });

    return {
      token,
      attemptId: created.attemptId,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async issueDummyPairingCode(ownerId: string, now: Date) {
    const { createHash, randomInt } = await import("node:crypto");
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const codeHash = createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS);

    const created = await this.deps.displayPairingCodeRepository.create({
      codeHash,
      expiresAt,
      ownerId,
    });

    return {
      code,
      codeHash,
      pairingCodeId: created.id,
      expiresAt,
    };
  }
}
