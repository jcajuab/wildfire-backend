import { createHash, randomUUID } from "node:crypto";
import { ValidationError } from "#/application/errors/validation";
import { type DisplayPairingSessionRepository } from "#/application/ports/display-auth";
import { type DisplayPairingCodeRepository } from "#/application/ports/display-pairing";
import { type DisplayRegistrationAttemptStore } from "#/application/ports/display-registration-attempt";

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

const hashPairingCode = (code: string): string =>
  createHash("sha256").update(code).digest("hex");

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
