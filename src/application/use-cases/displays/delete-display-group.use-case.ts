import { type DisplayGroupRepository } from "#/application/ports/displays";
import { NotFoundError } from "./errors";

export class DeleteDisplayGroupUseCase {
  constructor(
    private readonly deps: { displayGroupRepository: DisplayGroupRepository },
  ) {}

  async execute(input: { id: string }) {
    const deleted = await this.deps.displayGroupRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Display group not found");
  }
}
