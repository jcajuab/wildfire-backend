import { type ContentRepository } from "#/application/ports/content";
import { type UserRepository } from "#/application/ports/rbac";
import { toContentView } from "./content-view";
import { NotFoundError } from "./errors";

export class UpdateContentUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: { id: string; title: string }) {
    const existing = await this.deps.contentRepository.findById(input.id);
    if (!existing) {
      throw new NotFoundError("Content not found");
    }

    const updated = await this.deps.contentRepository.update(input.id, {
      title: input.title,
    });
    if (!updated) {
      throw new NotFoundError("Content not found");
    }

    const user = await this.deps.userRepository.findById(updated.createdById);
    return toContentView(updated, user?.name ?? null);
  }
}
