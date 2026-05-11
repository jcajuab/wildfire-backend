import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/errors/not-found";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type ContentRepository } from "#/application/ports/content";
import { type PlaylistRepository } from "#/application/ports/playlists";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type DeleteContentUseCase } from "#/application/use-cases/content/delete-content.use-case";
import { type DeletePlaylistUseCase } from "#/application/use-cases/playlists/delete-playlist.use-case";
import { type DeleteScheduleUseCase } from "#/application/use-cases/schedules/delete-schedule.use-case";
import { deleteOwnedResourcesForUser } from "./user-owned-resource-cleanup";

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

    await deleteOwnedResourcesForUser(this.deps, {
      userId: input.id,
      operation: "ban",
    });

    await this.deps.userRepository.update(input.id, {
      bannedAt: new Date(),
      isActive: false,
    });
    await this.deps.authSessionRepository.revokeAllForUser(input.id);
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
