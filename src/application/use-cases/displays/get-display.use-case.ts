import { type DisplayRepository } from "#/application/ports/displays";
import { NotFoundError } from "./errors";
import { withTelemetry } from "./shared";

export class GetDisplayUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      scheduleRepository?: unknown;
      playlistRepository?: unknown;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { id: string }) {
    const display = await this.deps.displayRepository.findById(input.id);
    if (!display) throw new NotFoundError("Display not found");
    return withTelemetry(display);
  }
}
