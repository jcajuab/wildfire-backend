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

  async execute(input: { id: string; ownerId?: string; isExcluded: boolean }) {
    const existing =
      input.ownerId && this.deps.contentRepository.findByIdForOwner
        ? await this.deps.contentRepository.findByIdForOwner(
            input.id,
            input.ownerId,
          )
        : await this.deps.contentRepository.findById(input.id);
    if (!existing) {
      throw new NotFoundError("Content not found");
    }
    if (existing.kind !== "PAGE") {
      throw new ValidationError("Only PDF page content can be excluded");
    }

    const updated =
      input.ownerId && this.deps.contentRepository.updateForOwner
        ? await this.deps.contentRepository.updateForOwner(
            input.id,
            input.ownerId,
            {
              isExcluded: input.isExcluded,
            },
          )
        : await this.deps.contentRepository.update(input.id, {
            isExcluded: input.isExcluded,
          });
    if (!updated) {
      throw new NotFoundError("Content not found");
    }
    const user = await this.deps.userRepository.findById(updated.ownerId);
    return toContentView(updated, user?.name ?? null);
  }
}
