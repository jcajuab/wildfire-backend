import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayRepository } from "#/application/ports/displays";
import { computePlaylistEffectiveDuration } from "#/application/use-cases/shared/playlist-effective-duration";
import { isValidDuration, isValidSequence } from "#/domain/playlists/playlist";
import { NotFoundError } from "./errors";
import { assertPlaylistEligibleContent } from "./shared";

export class EstimatePlaylistDurationUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      displayRepository: DisplayRepository;
    },
  ) {}

  async execute(input: {
    ownerId?: string;
    displayId: string;
    items: readonly {
      contentId: string;
      duration: number;
      sequence: number;
    }[];
  }) {
    const display = await this.deps.displayRepository.findById(input.displayId);
    if (!display) {
      throw new NotFoundError("Display not found");
    }

    for (const item of input.items) {
      if (!isValidSequence(item.sequence)) {
        throw new ValidationError("Invalid sequence");
      }
      if (!isValidDuration(item.duration)) {
        throw new ValidationError("Invalid duration");
      }
    }

    const contentIds = Array.from(
      new Set(input.items.map((item) => item.contentId)),
    );
    const contents =
      input.ownerId && this.deps.contentRepository.findByIdsForOwner
        ? await this.deps.contentRepository.findByIdsForOwner(
            contentIds,
            input.ownerId,
          )
        : await this.deps.contentRepository.findByIds(contentIds);
    for (const content of contents) {
      assertPlaylistEligibleContent(content);
    }

    const result = await computePlaylistEffectiveDuration({
      items: [...input.items]
        .sort((left, right) => left.sequence - right.sequence)
        .map((item) => ({
          contentId: item.contentId,
          duration: item.duration,
        })),
      contentRepository: this.deps.contentRepository,
      ownerId: input.ownerId,
    });

    return result;
  }
}
