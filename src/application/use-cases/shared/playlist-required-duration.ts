import { type ContentRepository } from "#/application/ports/content";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { computePlaylistEffectiveDuration } from "#/application/use-cases/shared/playlist-effective-duration";

export const computeRequiredMinPlaylistDurationSeconds = async (input: {
  playlistRepository: PlaylistRepository;
  contentRepository: ContentRepository;
  playlistId: string;
}) => {
  const items = await input.playlistRepository.listItems(input.playlistId);
  const result = await computePlaylistEffectiveDuration({
    items: items.map((item) => ({
      contentId: item.contentId,
      duration: item.duration,
    })),
    contentRepository: input.contentRepository,
  });
  return result.effectiveDurationSeconds;
};
