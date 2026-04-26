import { type DisplayKeyRepository } from "#/application/ports/display-auth";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { NotFoundError } from "./errors";

export class UnregisterDisplayUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayKeyRepository: DisplayKeyRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
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

    // Notify the display's SSE stream BEFORE revoking keys, so the
    // connected display client receives the event and disconnects.
    this.deps.displayEventPublisher?.publish({
      type: "display_unregistered",
      displayId: display.id,
      reason: "unregistered",
    });

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
