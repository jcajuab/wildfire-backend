import { ValidationError } from "#/application/errors/validation";
import { type DisplayGroupRepository } from "#/application/ports/displays";

const collapseWhitespace = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const normalizeName = (value: string): string =>
  collapseWhitespace(value).toLowerCase();

const GROUP_PALETTE_SIZE = 12;

const normalizeColorIndex = (value: number): number =>
  ((value % GROUP_PALETTE_SIZE) + GROUP_PALETTE_SIZE) % GROUP_PALETTE_SIZE;

const getNextColorIndex = (
  groups: readonly { colorIndex: number }[],
): number => {
  if (groups.length === 0) return 0;
  const maxColorIndex = Math.max(...groups.map((group) => group.colorIndex));
  return normalizeColorIndex(maxColorIndex + 1);
};

export class CreateDisplayGroupUseCase {
  constructor(
    private readonly deps: { displayGroupRepository: DisplayGroupRepository },
  ) {}

  async execute(input: { name: string; colorIndex?: number }) {
    const displayName = collapseWhitespace(input.name);
    if (displayName.length === 0) {
      throw new ValidationError("Group name is required");
    }
    if (input.colorIndex !== undefined && !Number.isInteger(input.colorIndex)) {
      throw new ValidationError("Group color index must be an integer");
    }
    const normalizedInputName = normalizeName(displayName);
    const existingGroups = await this.deps.displayGroupRepository.list();
    const existing = existingGroups.find(
      (group) => normalizeName(group.name) === normalizedInputName,
    );
    if (existing) return existing;
    const nextColorIndex =
      input.colorIndex !== undefined
        ? normalizeColorIndex(input.colorIndex)
        : getNextColorIndex(existingGroups);
    return this.deps.displayGroupRepository.create({
      name: displayName,
      colorIndex: nextColorIndex,
    });
  }
}
