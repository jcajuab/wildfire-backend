import { type ContentRepository } from "#/application/ports/content";

export interface PlaylistDurationItemInput {
  readonly contentId: string;
  readonly duration: number;
}

export interface PlaylistDurationItemBreakdown {
  readonly contentId: string;
  readonly baseDurationSeconds: number;
  readonly effectiveDurationSeconds: number;
}

export interface PlaylistDurationComputation {
  readonly baseDurationSeconds: number;
  readonly effectiveDurationSeconds: number;
  readonly items: readonly PlaylistDurationItemBreakdown[];
}

const toPositiveInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;

export const computePlaylistEffectiveDuration = async (input: {
  items: readonly PlaylistDurationItemInput[];
  contentRepository: ContentRepository;
  ownerId?: string;
}): Promise<PlaylistDurationComputation> => {
  if (input.items.length === 0) {
    return {
      baseDurationSeconds: 0,
      effectiveDurationSeconds: 0,
      items: [],
    };
  }

  const requestedContentIds = Array.from(
    new Set(input.items.map((item) => item.contentId)),
  );
  const contents =
    input.ownerId !== undefined && input.contentRepository.findByIdsForOwner
      ? await input.contentRepository.findByIdsForOwner(
          requestedContentIds,
          input.ownerId,
        )
      : await input.contentRepository.findByIds(requestedContentIds);
  const contentById = new Map(contents.map((content) => [content.id, content]));

  let baseDurationSeconds = 0;
  const itemBreakdown: PlaylistDurationItemBreakdown[] = [];

  for (const item of input.items) {
    const content = contentById.get(item.contentId);
    if (!content) {
      continue;
    }

    const itemBaseDurationSeconds = toPositiveInteger(item.duration, 1);
    baseDurationSeconds += itemBaseDurationSeconds;
    itemBreakdown.push({
      contentId: content.id,
      baseDurationSeconds: itemBaseDurationSeconds,
      effectiveDurationSeconds: itemBaseDurationSeconds,
    });
  }

  return {
    baseDurationSeconds,
    effectiveDurationSeconds: baseDurationSeconds,
    items: itemBreakdown,
  };
};
