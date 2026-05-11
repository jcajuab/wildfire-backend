import { AppError } from "#/application/errors/app-error";
import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/errors/not-found";
import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type ContentRecord,
  type ContentRepository,
} from "#/application/ports/content";
import { type PlaylistRepository } from "#/application/ports/playlists";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type DeleteContentUseCase } from "#/application/use-cases/content/delete-content.use-case";
import { type DeletePlaylistUseCase } from "#/application/use-cases/playlists/delete-playlist.use-case";
import { type DeleteScheduleUseCase } from "#/application/use-cases/schedules/delete-schedule.use-case";

class UserBanCleanupConflictError extends AppError {
  constructor(message: string) {
    super(message, {
      code: "user_ban_cleanup_conflict",
      httpStatus: 409,
    });
  }
}

export class BanUserUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      authSessionRepository: AuthSessionRepository;
      authorizationRepository: AuthorizationRepository;
      contentRepository: ContentRepository;
      playlistRepository: PlaylistRepository;
      scheduleRepository: ScheduleRepository;
      deleteContent: Pick<DeleteContentUseCase, "execute">;
      deletePlaylist: Pick<DeletePlaylistUseCase, "execute">;
      deleteSchedule: Pick<DeleteScheduleUseCase, "execute">;
    },
  ) {}

  async execute(input: { id: string; callerUserId: string }): Promise<void> {
    const callerIsAdmin = await this.deps.authorizationRepository.isAdminUser(
      input.callerUserId,
    );
    if (!callerIsAdmin) {
      throw new ForbiddenError("Only administrators can ban users.");
    }

    if (input.id === input.callerUserId) {
      throw new ForbiddenError("You cannot ban yourself.");
    }

    const user = await this.deps.userRepository.findById(input.id);
    if (!user) throw new NotFoundError("User not found");

    await this.deleteOwnedResourcesForBan(input.id);

    await this.deps.userRepository.update(input.id, {
      bannedAt: new Date(),
      isActive: false,
    });
    await this.deps.authSessionRepository.revokeAllForUser(input.id);
  }

  private async deleteOwnedResourcesForBan(userId: string): Promise<void> {
    const [ownedSchedules, ownedPlaylists, ownedContent] = await Promise.all([
      this.listOwnedSchedules(userId),
      this.deps.playlistRepository.listForOwner(userId),
      this.listOwnedContent(userId),
    ]);

    const ownedScheduleIds = new Set(
      ownedSchedules.map((schedule) => schedule.id),
    );

    for (const playlist of ownedPlaylists) {
      const schedules = await this.deps.scheduleRepository.listByPlaylistId(
        playlist.id,
      );
      const crossOwnerSchedule = schedules.find(
        (schedule) => schedule.createdBy !== userId,
      );
      if (crossOwnerSchedule) {
        throw new UserBanCleanupConflictError(
          "Cannot ban this user because one of their playlists is used by another user's schedule.",
        );
      }
    }

    for (const content of ownedContent) {
      const playlists =
        (await this.deps.playlistRepository.listByContentId?.(content.id)) ??
        [];
      const crossOwnerPlaylist = playlists.find(
        (playlist) => playlist.ownerId !== userId,
      );
      if (crossOwnerPlaylist) {
        throw new UserBanCleanupConflictError(
          "Cannot ban this user because one of their content items is used by another user's playlist.",
        );
      }

      const schedules =
        (await this.deps.scheduleRepository.listByContentId?.(content.id)) ??
        [];
      const crossOwnerSchedule = schedules.find(
        (schedule) => schedule.createdBy !== userId,
      );
      if (crossOwnerSchedule) {
        throw new UserBanCleanupConflictError(
          "Cannot ban this user because one of their content items is used by another user's schedule.",
        );
      }
      for (const schedule of schedules) {
        ownedScheduleIds.add(schedule.id);
      }
    }

    for (const scheduleId of ownedScheduleIds) {
      await this.deps.deleteSchedule.execute({
        id: scheduleId,
        ownerId: userId,
      });
    }

    for (const playlist of ownedPlaylists) {
      await this.deps.deletePlaylist.execute({
        id: playlist.id,
        ownerId: userId,
      });
    }

    for (const content of ownedContent) {
      await this.deps.deleteContent.execute({
        id: content.id,
        ownerId: userId,
      });
    }
  }

  private async listOwnedSchedules(userId: string) {
    if (this.deps.scheduleRepository.listByCreator) {
      return this.deps.scheduleRepository.listByCreator(userId);
    }
    const schedules = await this.deps.scheduleRepository.list();
    return schedules.filter((schedule) => schedule.createdBy === userId);
  }

  private async listOwnedContent(userId: string): Promise<ContentRecord[]> {
    const items: ContentRecord[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const page = await this.deps.contentRepository.listForOwner({
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
}

export class UnbanUserUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: { id: string; callerUserId: string }): Promise<void> {
    const callerIsAdmin = await this.deps.authorizationRepository.isAdminUser(
      input.callerUserId,
    );
    if (!callerIsAdmin) {
      throw new ForbiddenError("Only administrators can unban users.");
    }

    const user = await this.deps.userRepository.findById(input.id);
    if (!user) throw new NotFoundError("User not found");

    await this.deps.userRepository.update(input.id, {
      bannedAt: null,
      isActive: true,
    });
  }
}
