import { describe, expect, test } from "bun:test";
import {
  ListPermissionsUseCase,
  ListRolesUseCase,
  SetUserRolesUseCase,
} from "#/application/use-cases/rbac";
import { Permission } from "#/domain/rbac/permission";

describe("RBAC use cases", () => {
  test("ListRolesUseCase includes usersCount", async () => {
    const useCase = new ListRolesUseCase({
      roleRepository: {
        list: async () => [
          {
            id: "role-1",
            name: "Editor",
            description: null,
            isSystem: false,
          },
        ],
      } as never,
      userRoleRepository: {
        listUserCountByRoleIds: async () => ({ "role-1": 2 }),
      } as never,
    });

    const result = await useCase.execute({ page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: "role-1",
        usersCount: 2,
      }),
    );
  });

  test("ListPermissionsUseCase returns paginated permission list", async () => {
    const useCase = new ListPermissionsUseCase({
      permissionRepository: {
        list: async () => [
          {
            id: "perm-1",
            resource: "roles",
            action: "read",
            isRoot: false,
          },
          {
            id: "perm-2",
            resource: "roles",
            action: "create",
            isRoot: false,
          },
        ],
      } as never,
    });

    const result = await useCase.execute({ page: 1, pageSize: 1 });
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe("perm-1");
  });

  test("SetUserRolesUseCase updates roles for target user", async () => {
    let assignedRoleIds: string[] = [];
    const useCase = new SetUserRolesUseCase({
      userRepository: {
        findById: async () => ({
          id: "user-1",
          username: "editor",
          email: "editor@example.com",
          name: "Editor",
          isActive: true,
        }),
      } as never,
      roleRepository: {
        list: async () =>
          assignedRoleIds.map((id) => ({
            id,
            name: id,
            description: null,
            isSystem: false,
          })),
        findByIds: async (ids: string[]) =>
          ids.map((id) => ({
            id,
            name: id,
            description: null,
            isSystem: false,
          })),
      } as never,
      userRoleRepository: {
        setUserRoles: async (_userId: string, roleIds: string[]) => {
          assignedRoleIds = [...roleIds];
        },
        listRolesByUserId: async () => [],
      } as never,
      permissionRepository: {
        findByIds: async () => [],
      } as never,
      rolePermissionRepository: {
        listPermissionsByRoleId: async () => [],
      } as never,
      authorizationRepository: {
        findPermissionsForUser: async () => [Permission.parse("users:update")],
        isRootUser: async () => false,
      } as never,
    });

    const result = await useCase.execute({
      userId: "user-1",
      roleIds: ["role-alpha", "role-beta"],
      actorId: "admin-1",
    });

    expect(assignedRoleIds).toEqual(["role-alpha", "role-beta"]);
    expect(result).toHaveLength(2);
  });
});
