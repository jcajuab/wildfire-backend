import { ValidationError } from "#/application/errors/validation";
import { type EmergencySlotRepository } from "#/application/ports/emergency-slots";
import { EMERGENCY_SLOT_COUNT } from "./list-emergency-slots.use-case";

export class ClearEmergencySlotUseCase {
  constructor(
    private readonly deps: {
      emergencySlotRepository: EmergencySlotRepository;
    },
  ) {}

  async execute(input: { slotIndex: number }): Promise<void> {
    if (
      !Number.isInteger(input.slotIndex) ||
      input.slotIndex < 1 ||
      input.slotIndex > EMERGENCY_SLOT_COUNT
    ) {
      throw new ValidationError(
        `slotIndex must be an integer between 1 and ${EMERGENCY_SLOT_COUNT}`,
      );
    }

    await this.deps.emergencySlotRepository.delete(input.slotIndex);
  }
}
