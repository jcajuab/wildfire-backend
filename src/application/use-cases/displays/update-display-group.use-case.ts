import { ValidationError } from "#/application/errors/validation";
import { type DisplayGroupRepository } from "#/application/ports/displays";
import { DisplayGroupConflictError, NotFoundError } from "./errors";

const collapseWhitespace = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const normalizeName = (value: string): string =>
  collapseWhitespace(value).toLowerCase();

export class UpdateDisplayGroupUseCase {
  constructor(
    private readonly deps: { displayGroupRepository: DisplayGroupRepository },
  ) {}

  async execute(input: { id: string; name?: string }) {
    const name =
      input.name === undefined ? undefined : collapseWhitespace(input.name);
    if (name !== undefined && name.length === 0) {
      throw new ValidationError("Group name is required");
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
    });
    if (!updated) throw new NotFoundError("Display group not found");
    return updated;
  }
}
