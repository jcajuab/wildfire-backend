import { type ContentIngestionJobRepository } from "#/application/ports/content-jobs";
import { toContentJobView } from "./content-job-view";
import { NotFoundError } from "./errors";

export class GetContentJobUseCase {
  constructor(
    private readonly deps: {
      contentIngestionJobRepository: ContentIngestionJobRepository;
    },
  ) {}

  async execute(input: { id: string; ownerId?: string }) {
    const job =
      input.ownerId && this.deps.contentIngestionJobRepository.findByIdForOwner
        ? await this.deps.contentIngestionJobRepository.findByIdForOwner(
            input.id,
            input.ownerId,
          )
        : await this.deps.contentIngestionJobRepository.findById(input.id);
    if (!job) {
      throw new NotFoundError("Content job not found");
    }
    return toContentJobView(job);
  }
}
