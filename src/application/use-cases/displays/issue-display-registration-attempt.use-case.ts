import { createHash, randomInt } from "node:crypto";
import {
  DisplayPairingCodeCollisionError,
  type DisplayPairingCodeRepository,
} from "#/application/ports/display-pairing";
import { type DisplayRegistrationAttemptStore } from "#/application/ports/display-registration-attempt";

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

const hashPairingCode = (code: string): string =>
  createHash("sha256").update(code).digest("hex");

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
