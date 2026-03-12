import {
  type DisplayGroupRepository,
  type DisplayRepository,
} from "#/application/ports/displays";
import { NotFoundError } from "./errors";

export class SetDisplayGroupsUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayGroupRepository: DisplayGroupRepository;
    },
  ) {}

  async execute(input: { displayId: string; groupIds: string[] }) {
    const display = await this.deps.displayRepository.findById(input.displayId);
    if (!display) throw new NotFoundError("Display not found");
    const uniqueGroupIds = [...new Set(input.groupIds)];

    if (uniqueGroupIds.length > 0) {
      const groups = await this.deps.displayGroupRepository.list();
      const existingIds = new Set(groups.map((g) => g.id));
      const unknown = uniqueGroupIds.find((id) => !existingIds.has(id));
      if (unknown) throw new NotFoundError("Display group not found");
    }

    await this.deps.displayGroupRepository.setDisplayGroups(
      input.displayId,
      uniqueGroupIds,
    );
  }
}
