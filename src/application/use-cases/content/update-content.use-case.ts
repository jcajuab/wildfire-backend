import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type UserRepository } from "#/application/ports/rbac";
import { type ContentStatus } from "#/domain/content/content";
import { toContentView } from "./content-view";
import { NotFoundError } from "./errors";

export class UpdateContentUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: { id: string; title?: string; status?: ContentStatus }) {
    if (input.title === undefined && input.status === undefined) {
      throw new ValidationError("At least one field must be provided");
    }
    const existing = await this.deps.contentRepository.findById(input.id);
    if (!existing) {
      throw new NotFoundError("Content not found");
    }

    const updated = await this.deps.contentRepository.update(input.id, {
      title: input.title,
      status: input.status,
    });
    if (!updated) {
      throw new NotFoundError("Content not found");
    }

    const user = await this.deps.userRepository.findById(updated.createdById);
    return toContentView(updated, user?.name ?? null);
  }
}
