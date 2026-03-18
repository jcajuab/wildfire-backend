import { ValidationError } from "#/application/errors/validation";
import { type DisplayGroupRepository } from "#/application/ports/displays";

const collapseWhitespace = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const normalizeName = (value: string): string =>
  collapseWhitespace(value).toLowerCase();

export class CreateDisplayGroupUseCase {
  constructor(
    private readonly deps: { displayGroupRepository: DisplayGroupRepository },
  ) {}

  async execute(input: { name: string }) {
    const displayName = collapseWhitespace(input.name);
    if (displayName.length === 0) {
      throw new ValidationError("Group name is required");
    }
    const normalizedInputName = normalizeName(displayName);
    const existingGroups = await this.deps.displayGroupRepository.list();
    const existing = existingGroups.find(
      (group) => normalizeName(group.name) === normalizedInputName,
    );
    if (existing) return existing;
    return this.deps.displayGroupRepository.create({
      name: displayName,
    });
  }
}
