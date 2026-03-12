import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { NotFoundError } from "./errors";

export class RequestDisplayRefreshUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: { id: string }): Promise<void> {
    const bumped = await this.deps.displayRepository.bumpRefreshNonce(input.id);
    if (!bumped) {
      throw new NotFoundError("Display not found");
    }
    this.deps.displayEventPublisher?.publish({
      type: "display_refresh_requested",
      displayId: input.id,
      reason: "refresh_nonce_bumped",
    });
  }
}
