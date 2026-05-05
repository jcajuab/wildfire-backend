import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { type EmergencySlotRepository } from "#/application/ports/emergency-slots";
import { type RuntimeControlRepository } from "#/application/ports/runtime-controls";
import { isRenderableEmergencyAsset } from "./shared";

export class ActivateGlobalEmergencyUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      contentRepository: ContentRepository;
      runtimeControlRepository: RuntimeControlRepository;
      emergencySlotRepository: EmergencySlotRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: { slotIndex: number; reason?: string }): Promise<void> {
    const now = new Date();

    if (
      !Number.isInteger(input.slotIndex) ||
      input.slotIndex < 1 ||
      input.slotIndex > 5
    ) {
      throw new ValidationError("slotIndex must be an integer between 1 and 5");
    }

    const slot = await this.deps.emergencySlotRepository.findByIndex(
      input.slotIndex,
    );
    if (!slot || !slot.contentId) {
      throw new ValidationError(
        `Emergency slot ${input.slotIndex} is empty. Configure it before activating.`,
      );
    }

    const asset = await this.deps.contentRepository.findById(slot.contentId);
    if (!asset || !isRenderableEmergencyAsset(asset)) {
      throw new ValidationError(
        "Emergency slot content must be a READY IMAGE, VIDEO, or TEXT asset",
      );
    }

    const displays = await this.deps.displayRepository.list();
    if (displays.length === 0) {
      throw new ValidationError(
        "Cannot start an emergency with no registered displays",
      );
    }

    await this.deps.runtimeControlRepository.setGlobalEmergencyState({
      active: true,
      startedAt: now,
      activeSlotIndex: input.slotIndex,
      at: now,
    });

    for (const display of displays) {
      this.deps.displayEventPublisher?.publish({
        type: "manifest_updated",
        displayId: display.id,
        reason: input.reason ?? "global_emergency_activated",
        timestamp: now.toISOString(),
      });
    }
  }
}
