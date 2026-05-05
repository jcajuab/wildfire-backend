import { ValidationError } from "#/application/errors/validation";
import { type DisplayRepository } from "#/application/ports/displays";
import { NotFoundError } from "./errors";
import { withTelemetry } from "./shared";

export class UpdateDisplayUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      scheduleRepository?: unknown;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: {
    id: string;
    ownerId?: string;
    name?: string;
    output?: string;
  }) {
    const normalizedName =
      input.name === undefined ? undefined : input.name.trim();
    if (normalizedName !== undefined && normalizedName.length === 0) {
      throw new ValidationError("Name is required");
    }

    const normalizeOptionalText = (
      value: string | undefined,
      fieldName: string,
    ): string | undefined => {
      if (value === undefined) return undefined;
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new ValidationError(`${fieldName} cannot be empty`);
      }
      return trimmed;
    };

    const normalizedOutputType = normalizeOptionalText(input.output, "output");

    const updated = await this.deps.displayRepository.update(input.id, {
      name: normalizedName,
      output: normalizedOutputType,
    });
    if (!updated) throw new NotFoundError("Display not found");
    return withTelemetry(updated);
  }
}
