import { ValidationError } from "#/application/errors/validation";
import { type DisplayGroupRepository } from "#/application/ports/displays";
import { DisplayGroupConflictError, NotFoundError } from "./errors";

const collapseWhitespace = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const normalizeName = (value: string): string =>
  collapseWhitespace(value).toLowerCase();

const GROUP_PALETTE_SIZE = 12;

const normalizeColorIndex = (value: number): number =>
  ((value % GROUP_PALETTE_SIZE) + GROUP_PALETTE_SIZE) % GROUP_PALETTE_SIZE;

export class UpdateDisplayGroupUseCase {
  constructor(
    private readonly deps: { displayGroupRepository: DisplayGroupRepository },
  ) {}

  async execute(input: { id: string; name?: string; colorIndex?: number }) {
    const name =
      input.name === undefined ? undefined : collapseWhitespace(input.name);
    if (name !== undefined && name.length === 0) {
      throw new ValidationError("Group name is required");
    }
    const colorIndex =
      input.colorIndex === undefined
        ? undefined
        : Number.isInteger(input.colorIndex)
          ? normalizeColorIndex(input.colorIndex)
          : null;
    if (colorIndex === null) {
      throw new ValidationError("Group color index must be an integer");
    }

    if (name !== undefined) {
      const groups = await this.deps.displayGroupRepository.list();
      const normalizedName = normalizeName(name);
      const existing = groups.find((group) => group.id === input.id);
      if (!existing) {
        throw new NotFoundError("Display group not found");
      }
      const conflictingGroup = groups.find(
        (group) =>
          group.id !== input.id && normalizeName(group.name) === normalizedName,
      );
      if (conflictingGroup) {
        throw new DisplayGroupConflictError(
          "A display group with this name already exists",
        );
      }
    }

    const updated = await this.deps.displayGroupRepository.update(input.id, {
      name,
      colorIndex: colorIndex ?? undefined,
    });
    if (!updated) throw new NotFoundError("Display group not found");
    return updated;
  }
}
