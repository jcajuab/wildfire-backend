import { ForbiddenError } from "#/application/errors/forbidden";
import { assertNotDcismUser } from "#/application/guards/dcism-user.guard";
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
import { deleteOwnedResourcesForUser } from "#/application/use-cases/users/user-owned-resource-cleanup";
import { NotFoundError } from "./errors";

export class DeleteUserUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      authorizationRepository: AuthorizationRepository;
      authSessionRepository: AuthSessionRepository;
      contentRepository: ContentRepository;
      playlistRepository: PlaylistRepository;
      scheduleRepository: ScheduleRepository;
      deleteContent: Pick<DeleteContentUseCase, "execute">;
      deletePlaylist: Pick<DeletePlaylistUseCase, "execute">;
      deleteSchedule: Pick<DeleteScheduleUseCase, "execute">;
    },
  ) {}

  async execute(input: { id: string; callerUserId?: string }) {
    if (input.callerUserId != null && input.id === input.callerUserId) {
      throw new ForbiddenError("You cannot delete yourself.");
    }

    const user = await this.deps.userRepository.findById(input.id);
    if (!user) throw new NotFoundError("User not found");

    const targetIsAdmin = await this.deps.authorizationRepository.isAdminUser(
      user.id,
    );
    if (targetIsAdmin) {
      throw new ForbiddenError("Cannot delete an Admin user");
    }

    assertNotDcismUser(
      { ...user, isAdmin: targetIsAdmin },
      "Cannot delete a DCISM user. DCISM users are managed by the HTSHADOW file.",
    );

    await deleteOwnedResourcesForUser(
      {
        contentRepository: this.deps.contentRepository,
        playlistRepository: this.deps.playlistRepository,
        scheduleRepository: this.deps.scheduleRepository,
        deleteContent: this.deps.deleteContent,
        deletePlaylist: this.deps.deletePlaylist,
        deleteSchedule: this.deps.deleteSchedule,
      },
      { userId: input.id, operation: "delete" },
    );

    await this.deps.authSessionRepository.revokeAllForUser(input.id);
    const deleted = await this.deps.userRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("User not found");
  }
}

/** Deletes the current user (self-deletion). Auth only; no permission check. */
export class DeleteCurrentUserUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: { userId: string }) {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

    const isAdmin = await this.deps.authorizationRepository.isAdminUser(
      user.id,
    );
    assertNotDcismUser(
      { ...user, isAdmin },
      "DCISM users cannot delete their account.",
    );

    await this.deps.userRepository.delete(input.userId);
  }
}
