import { type DisplayPairingCodeRepository } from "#/application/ports/display-pairing";
import { type DisplayRegistrationAttemptStore } from "#/application/ports/display-registration-attempt";
import { NotFoundError } from "./errors";

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
