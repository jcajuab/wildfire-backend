import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { type RuntimeControlRepository } from "#/application/ports/runtime-controls";

export class DeactivateGlobalEmergencyUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      runtimeControlRepository: RuntimeControlRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: { reason?: string }): Promise<void> {
    const now = new Date();
    await this.deps.runtimeControlRepository.setGlobalEmergencyState({
      active: false,
      startedAt: null,
      at: now,
    });
    const displays = await this.deps.displayRepository.list();
    for (const display of displays) {
      this.deps.displayEventPublisher?.publish({
        type: "manifest_updated",
        displayId: display.id,
        reason: input.reason ?? "global_emergency_deactivated",
        timestamp: now.toISOString(),
      });
    }
  }
}
