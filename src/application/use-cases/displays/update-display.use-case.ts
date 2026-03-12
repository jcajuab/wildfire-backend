import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayRepository } from "#/application/ports/displays";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { NotFoundError } from "./errors";
import { isRenderableEmergencyAsset, withTelemetry } from "./shared";

export class UpdateDisplayUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      scheduleRepository: ScheduleRepository;
      contentRepository: ContentRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: {
    id: string;
    ownerId?: string;
    name?: string;
    location?: string | null;
    ipAddress?: string | null;
    macAddress?: string | null;
    screenWidth?: number | null;
    screenHeight?: number | null;
    output?: string | null;
    orientation?: "LANDSCAPE" | "PORTRAIT" | null;
    emergencyContentId?: string | null;
  }) {
    const normalizedName =
      input.name === undefined ? undefined : input.name.trim();
    if (normalizedName !== undefined && normalizedName.length === 0) {
      throw new ValidationError("Name is required");
    }

    const normalizeOptionalText = (
      value: string | null | undefined,
      fieldName: string,
    ): string | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new ValidationError(`${fieldName} cannot be empty`);
      }
      return trimmed;
    };

    const ipAddress = normalizeOptionalText(input.ipAddress, "ipAddress");
    const macAddress = normalizeOptionalText(input.macAddress, "macAddress");
    const normalizedOutputType = normalizeOptionalText(input.output, "output");

    const normalizeDimension = (
      value: number | null | undefined,
      fieldName: string,
    ): number | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (!Number.isInteger(value) || value <= 0) {
        throw new ValidationError(`${fieldName} must be a positive integer`);
      }
      return value;
    };

    const screenWidth = normalizeDimension(input.screenWidth, "screenWidth");
    const screenHeight = normalizeDimension(input.screenHeight, "screenHeight");
    if (input.emergencyContentId !== undefined && input.emergencyContentId) {
      const emergencyAsset =
        input.ownerId && this.deps.contentRepository.findByIdForOwner
          ? await this.deps.contentRepository.findByIdForOwner(
              input.emergencyContentId,
              input.ownerId,
            )
          : await this.deps.contentRepository.findById(
              input.emergencyContentId,
            );
      if (!emergencyAsset || !isRenderableEmergencyAsset(emergencyAsset)) {
        throw new ValidationError(
          "emergencyContentId must reference a READY root IMAGE, VIDEO, or PDF asset",
        );
      }
    }

    const updated = await this.deps.displayRepository.update(input.id, {
      name: normalizedName,
      location: input.location,
      ipAddress,
      macAddress,
      screenWidth,
      screenHeight,
      output: normalizedOutputType,
      orientation: input.orientation,
      emergencyContentId: input.emergencyContentId,
    });
    if (!updated) throw new NotFoundError("Display not found");
    return withTelemetry(updated);
  }
}
