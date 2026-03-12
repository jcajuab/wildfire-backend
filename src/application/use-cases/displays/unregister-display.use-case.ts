import { type DisplayKeyRepository } from "#/application/ports/display-auth";
import { type DisplayRepository } from "#/application/ports/displays";
import { NotFoundError } from "./errors";

export class UnregisterDisplayUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayKeyRepository: DisplayKeyRepository;
      lifecycleEventPublisher?: {
        publish(input: {
          type: "display_unregistered";
          displayId: string;
          slug: string;
          occurredAt: string;
        }): void;
      };
    },
  ) {}

  async execute(input: { id: string; actorId: string }) {
    const display = await this.deps.displayRepository.findById(input.id);
    if (!display) {
      throw new NotFoundError("Display not found");
    }

    const now = new Date();
    await this.deps.displayKeyRepository.revokeByDisplayId(input.id, now);
    await this.deps.displayRepository.delete(input.id);
    this.deps.lifecycleEventPublisher?.publish({
      type: "display_unregistered",
      displayId: display.id,
      slug: display.slug,
      occurredAt: now.toISOString(),
    });
  }
}
