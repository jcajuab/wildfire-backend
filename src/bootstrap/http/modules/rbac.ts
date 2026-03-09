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
import {
  type RbacRouterDeps,
  type RbacRouterUseCases,
} from "#/interfaces/http/routes/rbac/shared";

export interface RbacHttpModule {
  deps: RbacRouterDeps;
  useCases: RbacRouterUseCases;
}

export const createRbacHttpModule = (
  deps: Omit<RbacRouterDeps, "checkPermissionUseCase">,
): RbacHttpModule => {
  const routerDeps: RbacRouterDeps = {
    ...deps,
    checkPermissionUseCase: new CheckPermissionUseCase({
      authorizationRepository: deps.repositories.authorizationRepository,
    }),
  };

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
    },
  };
};
