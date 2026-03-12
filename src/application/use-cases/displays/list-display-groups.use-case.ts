import { type DisplayGroupRepository } from "#/application/ports/displays";

export class ListDisplayGroupsUseCase {
  constructor(
    private readonly deps: { displayGroupRepository: DisplayGroupRepository },
  ) {}

  async execute() {
    return this.deps.displayGroupRepository.list();
  }
}
