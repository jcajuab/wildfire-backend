import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayRepository } from "#/application/ports/displays";
import {
  computePlaylistEffectiveDuration,
  DEFAULT_SCROLL_PX_PER_SECOND,
} from "#/application/use-cases/shared/playlist-effective-duration";
import { isValidDuration, isValidSequence } from "#/domain/playlists/playlist";
import { NotFoundError } from "./errors";

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
    if (
      typeof display.screenWidth !== "number" ||
      typeof display.screenHeight !== "number"
    ) {
      throw new ValidationError("Display resolution is required");
    }

    for (const item of input.items) {
      if (!isValidSequence(item.sequence)) {
        throw new ValidationError("Invalid sequence");
      }
      if (!isValidDuration(item.duration)) {
        throw new ValidationError("Invalid duration");
      }
    }

    const result = await computePlaylistEffectiveDuration({
      items: [...input.items]
        .sort((left, right) => left.sequence - right.sequence)
        .map((item) => ({
          contentId: item.contentId,
          duration: item.duration,
        })),
      contentRepository: this.deps.contentRepository,
      displayWidth: display.screenWidth,
      displayHeight: display.screenHeight,
      defaultScrollPxPerSecond: DEFAULT_SCROLL_PX_PER_SECOND,
      ownerId: input.ownerId,
    });

    return result;
  }
}
