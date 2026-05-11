import { type AuthIdentityCache } from "#/application/ports/auth";
import { DeleteContentUseCase } from "#/application/use-cases/content";
import { DeletePlaylistUseCase } from "#/application/use-cases/playlists";
import {
  CheckPermissionUseCase,
  CreateRoleUseCase,
  CreateUserUseCase,
  DeleteRoleUseCase,
  DeleteUserUseCase,
  GetRolePermissionsUseCase,
  GetRoleUseCase,
  GetRoleUsersUseCase,
  GetUserRolesUseCase,
  GetUserUseCase,
  ListPermissionOptionsUseCase,
  ListPermissionsUseCase,
  ListRoleOptionsUseCase,
  ListRolesUseCase,
  ListUserOptionsUseCase,
  ListUsersUseCase,
  SetRolePermissionsUseCase,
  SetUserRolesUseCase,
  UpdateRoleUseCase,
  UpdateUserUseCase,
} from "#/application/use-cases/rbac";
import { DeleteScheduleUseCase } from "#/application/use-cases/schedules";
import { AdminResetPasswordUseCase } from "#/application/use-cases/users/admin-reset-password.use-case";
import {
  BanUserUseCase,
  UnbanUserUseCase,
} from "#/application/use-cases/users/ban-user.use-case";
import { CachedAuthorizationRepository } from "#/infrastructure/db/repositories/cached-authorization.repo";
import { ContentPlaylistReportingRepository } from "#/infrastructure/db/repositories/content-playlist-reporting.repo";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import {
  type RbacRouterDeps,
  type RbacRouterUseCases,
} from "#/interfaces/http/routes/rbac/shared";
import { retryWithBackoff } from "#/shared/retry";

export interface RbacHttpModule {
  deps: RbacRouterDeps;
  useCases: RbacRouterUseCases;
}

const requireRepository = <T>(value: T | undefined, name: string): T => {
  if (value == null) {
    throw new Error(`${name} is required for the RBAC HTTP module.`);
  }
  return value;
};

const invalidateUserPermissions = async (
  userId: string,
  authIdentityCache: AuthIdentityCache,
  authSessionRepository: RbacRouterDeps["authSessionRepository"],
): Promise<void> => {
  try {
    await CachedAuthorizationRepository.invalidateUser(userId);
  } catch (error) {
    logger.warn(
      addErrorContext(
        { event: "rbac.invalidate.authorization_cache_failed", userId },
        error,
      ),
      "Failed to invalidate authorization cache for user",
    );
  }

  try {
    await retryWithBackoff(
      () => authIdentityCache.invalidatePermissions(userId),
      { maxAttempts: 2, baseDelayMs: 50, maxDelayMs: 200 },
    );
  } catch (error) {
    logger.warn(
      addErrorContext(
        { event: "rbac.invalidate.identity_cache_failed", userId },
        error,
      ),
      "Failed to invalidate identity cache for user",
    );
  }

  try {
    await authSessionRepository.revokeAllForUser(userId);
  } catch (error) {
    logger.warn(
      addErrorContext(
        { event: "rbac.invalidate.session_revoke_failed", userId },
        error,
      ),
      "Failed to revoke sessions for user",
    );
  }
};

export const createRbacHttpModule = (
  deps: Omit<RbacRouterDeps, "checkPermissionUseCase"> & {
    authIdentityCache: AuthIdentityCache;
  },
): RbacHttpModule => {
  const { authIdentityCache, ...routerDepsCandidates } = deps;

  const routerDeps: RbacRouterDeps = {
    ...routerDepsCandidates,
    checkPermissionUseCase: new CheckPermissionUseCase({
      authorizationRepository: deps.repositories.authorizationRepository,
    }),
  };

  const contentRepository = requireRepository(
    routerDeps.repositories.contentRepository,
    "contentRepository",
  );
  const playlistRepository = requireRepository(
    routerDeps.repositories.playlistRepository,
    "playlistRepository",
  );
  const scheduleRepository = requireRepository(
    routerDeps.repositories.scheduleRepository,
    "scheduleRepository",
  );
  const displayRepository = requireRepository(
    routerDeps.repositories.displayRepository,
    "displayRepository",
  );
  const contentStorage = requireRepository(
    routerDeps.contentStorage,
    "contentStorage",
  );

  const deleteScheduleUseCase = new DeleteScheduleUseCase({
    scheduleRepository,
    playlistRepository,
    contentRepository,
    displayEventPublisher: routerDeps.displayEventPublisher,
    adminLifecycleEventPublisher: routerDeps.adminLifecycleEventPublisher,
  });
  const deletePlaylistUseCase = new DeletePlaylistUseCase({
    playlistRepository,
    contentRepository,
    scheduleRepository,
    displayRepository,
  });
  const deleteContentUseCase = new DeleteContentUseCase({
    contentRepository,
    contentStorage,
    scheduleRepository,
    contentPlaylistReportingPort: new ContentPlaylistReportingRepository(),
  });

  return {
    deps: routerDeps,
    useCases: {
      listRoles: new ListRolesUseCase({
        roleRepository: routerDeps.repositories.roleRepository,
        userRoleRepository: routerDeps.repositories.userRoleRepository,
      }),
      listRoleOptions: new ListRoleOptionsUseCase({
        roleRepository: routerDeps.repositories.roleRepository,
      }),
      createRole: new CreateRoleUseCase({
        roleRepository: routerDeps.repositories.roleRepository,
      }),
      getRole: new GetRoleUseCase({
        roleRepository: routerDeps.repositories.roleRepository,
      }),
      updateRole: new UpdateRoleUseCase({
        roleRepository: routerDeps.repositories.roleRepository,
      }),
      deleteRole: new DeleteRoleUseCase({
        roleRepository: routerDeps.repositories.roleRepository,
      }),
      getRolePermissions: new GetRolePermissionsUseCase({
        roleRepository: routerDeps.repositories.roleRepository,
        rolePermissionRepository:
          routerDeps.repositories.rolePermissionRepository,
        permissionRepository: routerDeps.repositories.permissionRepository,
      }),
      setRolePermissions: new SetRolePermissionsUseCase({
        roleRepository: routerDeps.repositories.roleRepository,
        rolePermissionRepository:
          routerDeps.repositories.rolePermissionRepository,
        permissionRepository: routerDeps.repositories.permissionRepository,
        userRoleRepository: routerDeps.repositories.userRoleRepository,
        onPermissionsChanged: (userId) =>
          invalidateUserPermissions(
            userId,
            authIdentityCache,
            routerDeps.authSessionRepository,
          ),
      }),
      listPermissions: new ListPermissionsUseCase({
        permissionRepository: routerDeps.repositories.permissionRepository,
      }),
      listPermissionOptions: new ListPermissionOptionsUseCase({
        permissionRepository: routerDeps.repositories.permissionRepository,
      }),
      listUsers: new ListUsersUseCase({
        userRepository: routerDeps.repositories.userRepository,
      }),
      listUserOptions: new ListUserOptionsUseCase({
        userRepository: routerDeps.repositories.userRepository,
      }),
      createUser: new CreateUserUseCase({
        userRepository: routerDeps.repositories.userRepository,
      }),
      getUser: new GetUserUseCase({
        userRepository: routerDeps.repositories.userRepository,
      }),
      updateUser: new UpdateUserUseCase({
        userRepository: routerDeps.repositories.userRepository,
        authorizationRepository:
          routerDeps.repositories.authorizationRepository,
      }),
      deleteUser: new DeleteUserUseCase({
        userRepository: routerDeps.repositories.userRepository,
        authorizationRepository:
          routerDeps.repositories.authorizationRepository,
        authSessionRepository: routerDeps.authSessionRepository,
        contentRepository,
        playlistRepository,
        scheduleRepository,
        deleteContent: deleteContentUseCase,
        deletePlaylist: deletePlaylistUseCase,
        deleteSchedule: deleteScheduleUseCase,
      }),
      setUserRoles: new SetUserRolesUseCase({
        userRepository: routerDeps.repositories.userRepository,
        roleRepository: routerDeps.repositories.roleRepository,
        userRoleRepository: routerDeps.repositories.userRoleRepository,
        permissionRepository: routerDeps.repositories.permissionRepository,
        rolePermissionRepository:
          routerDeps.repositories.rolePermissionRepository,
        authorizationRepository:
          routerDeps.repositories.authorizationRepository,
        onPermissionsChanged: (userId) =>
          invalidateUserPermissions(
            userId,
            authIdentityCache,
            routerDeps.authSessionRepository,
          ),
      }),
      getUserRoles: new GetUserRolesUseCase({
        userRepository: routerDeps.repositories.userRepository,
        userRoleRepository: routerDeps.repositories.userRoleRepository,
        roleRepository: routerDeps.repositories.roleRepository,
      }),
      getRoleUsers: new GetRoleUsersUseCase({
        roleRepository: routerDeps.repositories.roleRepository,
        userRoleRepository: routerDeps.repositories.userRoleRepository,
        userRepository: routerDeps.repositories.userRepository,
      }),
      banUser: new BanUserUseCase({
        userRepository: routerDeps.repositories.userRepository,
        authSessionRepository: routerDeps.authSessionRepository,
        authorizationRepository:
          routerDeps.repositories.authorizationRepository,
        contentRepository,
        playlistRepository,
        scheduleRepository,
        deleteContent: deleteContentUseCase,
        deletePlaylist: deletePlaylistUseCase,
        deleteSchedule: deleteScheduleUseCase,
      }),
      unbanUser: new UnbanUserUseCase({
        userRepository: routerDeps.repositories.userRepository,
        authorizationRepository:
          routerDeps.repositories.authorizationRepository,
      }),
      adminResetPassword: new AdminResetPasswordUseCase({
        userRepository: routerDeps.repositories.userRepository,
        credentialsRepository: routerDeps.dbCredentialsRepository,
        passwordHasher: routerDeps.passwordHasher,
        authorizationRepository:
          routerDeps.repositories.authorizationRepository,
      }),
    },
  };
};
