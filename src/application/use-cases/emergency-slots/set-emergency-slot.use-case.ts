import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import {
  type EmergencySlotRecord,
  type EmergencySlotRepository,
} from "#/application/ports/emergency-slots";
import { isRenderableEmergencyAsset } from "#/application/use-cases/displays/shared";
import { EMERGENCY_SLOT_COUNT } from "./list-emergency-slots.use-case";

export class SetEmergencySlotUseCase {
  constructor(
    private readonly deps: {
      emergencySlotRepository: EmergencySlotRepository;
      contentRepository: ContentRepository;
    },
  ) {}

  async execute(input: {
    slotIndex: number;
    contentId: string;
  }): Promise<EmergencySlotRecord> {
    if (
      !Number.isInteger(input.slotIndex) ||
      input.slotIndex < 1 ||
      input.slotIndex > EMERGENCY_SLOT_COUNT
    ) {
      throw new ValidationError(
        `slotIndex must be an integer between 1 and ${EMERGENCY_SLOT_COUNT}`,
      );
    }

    const asset = await this.deps.contentRepository.findById(input.contentId);
    if (!asset || !isRenderableEmergencyAsset(asset)) {
      throw new ValidationError(
        "contentId must reference a READY IMAGE, VIDEO, or TEXT asset",
      );
    }

    return this.deps.emergencySlotRepository.upsert({
      slotIndex: input.slotIndex,
      label: asset.title.slice(0, 64),
      contentId: input.contentId,
      at: new Date(),
    });
  }
}
