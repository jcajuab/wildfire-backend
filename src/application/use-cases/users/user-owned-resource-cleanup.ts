import { AppError } from "#/application/errors/app-error";
import {
  type ContentRecord,
  type ContentRepository,
} from "#/application/ports/content";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type DeleteContentUseCase } from "#/application/use-cases/content/delete-content.use-case";
import { type DeletePlaylistUseCase } from "#/application/use-cases/playlists/delete-playlist.use-case";
import { type DeleteScheduleUseCase } from "#/application/use-cases/schedules/delete-schedule.use-case";

class UserOwnedResourceCleanupConflictError extends AppError {
  constructor(message: string, operation: CleanupOperation) {
    super(message, {
      code:
        operation === "ban"
          ? "user_ban_cleanup_conflict"
          : "user_delete_cleanup_conflict",
      httpStatus: 409,
    });
  }
}

type CleanupOperation = "ban" | "delete";

const operationPhrase: Record<CleanupOperation, string> = {
  ban: "ban this user",
  delete: "delete this user",
};

export interface UserOwnedResourceCleanupDeps {
  readonly contentRepository: ContentRepository;
  readonly playlistRepository: PlaylistRepository;
  readonly scheduleRepository: ScheduleRepository;
  readonly deleteContent: Pick<DeleteContentUseCase, "execute">;
  readonly deletePlaylist: Pick<DeletePlaylistUseCase, "execute">;
  readonly deleteSchedule: Pick<DeleteScheduleUseCase, "execute">;
}

export async function deleteOwnedResourcesForUser(
  deps: UserOwnedResourceCleanupDeps,
  input: { userId: string; operation: CleanupOperation },
): Promise<void> {
  const { userId, operation } = input;
  const [ownedSchedules, ownedPlaylists, ownedContent] = await Promise.all([
    listOwnedSchedules(deps.scheduleRepository, userId),
    deps.playlistRepository.listForOwner(userId),
    listOwnedContent(deps.contentRepository, userId),
  ]);

  const ownedScheduleIds = new Set(
    ownedSchedules.map((schedule) => schedule.id),
  );

  for (const playlist of ownedPlaylists) {
    const schedules = await deps.scheduleRepository.listByPlaylistId(
      playlist.id,
    );
    const crossOwnerSchedule = schedules.find(
      (schedule) => schedule.createdBy !== userId,
    );
    if (crossOwnerSchedule) {
      throw new UserOwnedResourceCleanupConflictError(
        `Cannot ${operationPhrase[operation]} because one of their playlists is used by another user's schedule.`,
        operation,
      );
    }
  }

  for (const content of ownedContent) {
    const playlists =
      (await deps.playlistRepository.listByContentId?.(content.id)) ?? [];
    const crossOwnerPlaylist = playlists.find(
      (playlist) => playlist.ownerId !== userId,
    );
    if (crossOwnerPlaylist) {
      throw new UserOwnedResourceCleanupConflictError(
        `Cannot ${operationPhrase[operation]} because one of their content items is used by another user's playlist.`,
        operation,
      );
    }

    const schedules =
      (await deps.scheduleRepository.listByContentId?.(content.id)) ?? [];
    const crossOwnerSchedule = schedules.find(
      (schedule) => schedule.createdBy !== userId,
    );
    if (crossOwnerSchedule) {
      throw new UserOwnedResourceCleanupConflictError(
        `Cannot ${operationPhrase[operation]} because one of their content items is used by another user's schedule.`,
        operation,
      );
    }
    for (const schedule of schedules) {
      ownedScheduleIds.add(schedule.id);
    }
  }

  for (const scheduleId of ownedScheduleIds) {
    await deps.deleteSchedule.execute({
      id: scheduleId,
      ownerId: userId,
    });
  }

  for (const playlist of ownedPlaylists) {
    await deps.deletePlaylist.execute({
      id: playlist.id,
      ownerId: userId,
    });
  }

  for (const content of ownedContent) {
    await deps.deleteContent.execute({
      id: content.id,
      ownerId: userId,
    });
  }
}

async function listOwnedSchedules(
  scheduleRepository: ScheduleRepository,
  userId: string,
) {
  if (scheduleRepository.listByCreator) {
    return scheduleRepository.listByCreator(userId);
  }
  const schedules = await scheduleRepository.list();
  return schedules.filter((schedule) => schedule.createdBy === userId);
}

async function listOwnedContent(
  contentRepository: ContentRepository,
  userId: string,
): Promise<ContentRecord[]> {
  const items: ContentRecord[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const page = await contentRepository.listForOwner({
      ownerId: userId,
      offset,
      limit,
    });
    items.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total || page.items.length === 0) {
      break;
    }
  }

  return items;
}
