import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type UserRepository } from "#/application/ports/rbac";
import { toContentView } from "./content-view";
import { NotFoundError } from "./errors";

export class SetContentExclusionUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: { id: string; isExcluded: boolean }) {
    const existing = await this.deps.contentRepository.findById(input.id);
    if (!existing) {
      throw new NotFoundError("Content not found");
    }
    if (existing.kind !== "PAGE") {
      throw new ValidationError("Only PDF page content can be excluded");
    }

    const updated = await this.deps.contentRepository.update(input.id, {
      isExcluded: input.isExcluded,
    });
    if (!updated) {
      throw new NotFoundError("Content not found");
    }
    const user = await this.deps.userRepository.findById(updated.createdById);
    return toContentView(updated, user?.name ?? null);
  }
}
