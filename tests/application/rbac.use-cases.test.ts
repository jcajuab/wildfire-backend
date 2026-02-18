import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "#/application/errors/forbidden";
import {
  CreateRoleUseCase,
  CreateUserUseCase,
  DeleteRoleUseCase,
  DeleteUserUseCase,
  GetRolePermissionsUseCase,
  GetRoleUseCase,
  GetRoleUsersUseCase,
  GetUserRolesUseCase,
  GetUserUseCase,
  ListPermissionsUseCase,
  ListRolesUseCase,
  ListUsersUseCase,
  NotFoundError,
  SetRolePermissionsUseCase,
  SetUserRolesUseCase,
  UpdateRoleUseCase,
  UpdateUserUseCase,
} from "#/application/use-cases/rbac";

describe("RBAC use cases", () => {
  test("ListUsersUseCase returns user list", async () => {
    const useCase = new ListUsersUseCase({
      userRepository: {
        list: async () => [
          {
            id: "user-1",
            email: "user@example.com",
            name: "User",
            isActive: true,
          },
        ],
      } as never,
    });

    const result = await useCase.execute();
    expect(result.items).toEqual([
      { id: "user-1", email: "user@example.com", name: "User", isActive: true },
    ]);
    expect(result.total).toBe(1);
  });

  test("CreateUserUseCase delegates to repository", async () => {
    const useCase = new CreateUserUseCase({
      userRepository: {
        findByEmail: async () => null,
        create: async (input: {
          email: string;
          name: string;
          isActive?: boolean;
        }) => ({ id: "user-1", ...input, isActive: true }),
      } as never,
    });

    await expect(
      useCase.execute({ email: "test@example.com", name: "Test" }),
    ).resolves.toEqual({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      isActive: true,
    });
  });

  test("GetUserUseCase throws when user missing", async () => {
    const useCase = new GetUserUseCase({
      userRepository: { findById: async () => null } as never,
    });

    await expect(useCase.execute({ id: "user-1" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("UpdateUserUseCase throws when user missing", async () => {
    const useCase = new UpdateUserUseCase({
      userRepository: { update: async () => null } as never,
      userRoleRepository: { listRolesByUserId: async () => [] } as never,
      roleRepository: { list: async () => [] } as never,
    });

    await expect(useCase.execute({ id: "user-1" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("UpdateUserUseCase throws ForbiddenError when target is Super Admin and caller is not", async () => {
    const systemRoleId = "role-sys";
    const targetUserId = "user-super";
    const callerUserId = "user-other";
    const useCase = new UpdateUserUseCase({
      userRepository: {
        update: async () => ({
          id: targetUserId,
          email: "s@example.com",
          name: "Super",
          isActive: true,
        }),
      } as never,
      userRoleRepository: {
        listRolesByUserId: async (userId: string) =>
          userId === targetUserId
            ? [{ userId: targetUserId, roleId: systemRoleId }]
            : userId === callerUserId
              ? [{ userId: callerUserId, roleId: "role-other" }]
              : [],
      } as never,
      roleRepository: {
        list: async () => [
          {
            id: systemRoleId,
            name: "Super Admin",
            description: null,
            isSystem: true,
          },
          {
            id: "role-other",
            name: "Editor",
            description: null,
            isSystem: false,
          },
        ],
      } as never,
    });

    await expect(
      useCase.execute({
        id: targetUserId,
        name: "Updated",
        callerUserId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("UpdateUserUseCase succeeds when target is Super Admin and caller is Super Admin", async () => {
    const systemRoleId = "role-sys";
    const targetUserId = "user-super";
    const callerUserId = "user-admin";
    const updatedUser = {
      id: targetUserId,
      email: "s@example.com",
      name: "Updated",
      isActive: true,
    };
    const useCase = new UpdateUserUseCase({
      userRepository: { update: async () => updatedUser } as never,
      userRoleRepository: {
        listRolesByUserId: async (userId: string) =>
          userId === targetUserId || userId === callerUserId
            ? [{ userId, roleId: systemRoleId }]
            : [],
      } as never,
      roleRepository: {
        list: async () => [
          {
            id: systemRoleId,
            name: "Super Admin",
            description: null,
            isSystem: true,
          },
        ],
      } as never,
    });

    await expect(
      useCase.execute({
        id: targetUserId,
        name: "Updated",
        callerUserId,
      }),
    ).resolves.toEqual(updatedUser);
  });

  test("DeleteUserUseCase throws when user missing", async () => {
    const useCase = new DeleteUserUseCase({
      userRepository: { delete: async () => false } as never,
      userRoleRepository: { listRolesByUserId: async () => [] } as never,
      roleRepository: { list: async () => [] } as never,
    });

    await expect(useCase.execute({ id: "user-1" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("DeleteUserUseCase throws ForbiddenError when target is Super Admin and caller is not", async () => {
    const systemRoleId = "role-sys";
    const targetUserId = "user-super";
    const callerUserId = "user-other";
    const useCase = new DeleteUserUseCase({
      userRepository: { delete: async () => true } as never,
      userRoleRepository: {
        listRolesByUserId: async (userId: string) =>
          userId === targetUserId
            ? [{ userId: targetUserId, roleId: systemRoleId }]
            : userId === callerUserId
              ? [{ userId: callerUserId, roleId: "role-other" }]
              : [],
      } as never,
      roleRepository: {
        list: async () => [
          {
            id: systemRoleId,
            name: "Super Admin",
            description: null,
            isSystem: true,
          },
          {
            id: "role-other",
            name: "Editor",
            description: null,
            isSystem: false,
          },
        ],
      } as never,
    });

    await expect(
      useCase.execute({ id: targetUserId, callerUserId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("DeleteUserUseCase succeeds when target is Super Admin and caller is Super Admin", async () => {
    const systemRoleId = "role-sys";
    const targetUserId = "user-super";
    const callerUserId = "user-admin";
    const useCase = new DeleteUserUseCase({
      userRepository: { delete: async () => true } as never,
      userRoleRepository: {
        listRolesByUserId: async (userId: string) =>
          userId === targetUserId || userId === callerUserId
            ? [{ userId, roleId: systemRoleId }]
            : [],
      } as never,
      roleRepository: {
        list: async () => [
          {
            id: systemRoleId,
            name: "Super Admin",
            description: null,
            isSystem: true,
          },
        ],
      } as never,
    });

    await expect(
      useCase.execute({ id: targetUserId, callerUserId }),
    ).resolves.toBeUndefined();
  });

  test("SetUserRolesUseCase returns assigned roles", async () => {
    const useCase = new SetUserRolesUseCase({
      userRepository: { findById: async () => ({ id: "user-1" }) } as never,
      roleRepository: {
        list: async () => [
          { id: "role-1", name: "Admin", description: null, isSystem: false },
          { id: "role-2", name: "Viewer", description: null, isSystem: false },
        ],
      } as never,
      userRoleRepository: {
        setUserRoles: async () => undefined,
      } as never,
    });

    await expect(
      useCase.execute({ userId: "user-1", roleIds: ["role-2"] }),
    ).resolves.toEqual([
      { id: "role-2", name: "Viewer", description: null, isSystem: false },
    ]);
  });

  test("ListRolesUseCase returns roles with user count", async () => {
    const useCase = new ListRolesUseCase({
      roleRepository: {
        list: async () => [
          {
            id: "role-1",
            name: "Admin",
            description: null,
            isSystem: false,
          },
        ],
      } as never,
      userRoleRepository: {
        listUserCountByRoleIds: async (roleIds: string[]) => {
          const out: Record<string, number> = {};
          for (const id of roleIds) {
            out[id] = id === "role-1" ? 2 : 0;
          }
          return out;
        },
      } as never,
    });

    const result = await useCase.execute();
    expect(result.items).toEqual([
      {
        id: "role-1",
        name: "Admin",
        description: null,
        isSystem: false,
        usersCount: 2,
      },
    ]);
    expect(result.total).toBe(1);
  });

  test("CreateRoleUseCase uses null description default", async () => {
    const useCase = new CreateRoleUseCase({
      roleRepository: {
        create: async (input: {
          name: string;
          description?: string | null;
        }) => ({
          id: "role-1",
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
        }),
      } as never,
    });

    await expect(useCase.execute({ name: "Editor" })).resolves.toEqual({
      id: "role-1",
      name: "Editor",
      description: null,
      isSystem: false,
    });
  });

  test("GetRoleUseCase throws when role missing", async () => {
    const useCase = new GetRoleUseCase({
      roleRepository: { findById: async () => null } as never,
    });

    await expect(useCase.execute({ id: "role-1" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("UpdateRoleUseCase throws when role missing", async () => {
    const useCase = new UpdateRoleUseCase({
      roleRepository: {
        findById: async () => null,
        update: async () => null,
      } as never,
    });

    await expect(useCase.execute({ id: "role-1" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("DeleteRoleUseCase throws when role missing", async () => {
    const useCase = new DeleteRoleUseCase({
      roleRepository: {
        findById: async () => null,
        delete: async () => false,
      } as never,
    });

    await expect(useCase.execute({ id: "role-1" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("GetRolePermissionsUseCase returns permissions", async () => {
    const useCase = new GetRolePermissionsUseCase({
      roleRepository: { findById: async () => ({ id: "role-1" }) } as never,
      rolePermissionRepository: {
        listPermissionsByRoleId: async () => [
          { roleId: "role-1", permissionId: "perm-1" },
        ],
      } as never,
      permissionRepository: {
        findByIds: async () => [
          { id: "perm-1", resource: "content", action: "read" },
        ],
      } as never,
    });

    await expect(useCase.execute({ roleId: "role-1" })).resolves.toEqual({
      items: [{ id: "perm-1", resource: "content", action: "read" }],
      total: 1,
      page: 1,
      pageSize: 50,
    });
  });

  test("SetRolePermissionsUseCase returns assigned permissions", async () => {
    const useCase = new SetRolePermissionsUseCase({
      roleRepository: { findById: async () => ({ id: "role-1" }) } as never,
      rolePermissionRepository: {
        setRolePermissions: async () => undefined,
      } as never,
      permissionRepository: {
        findByIds: async () => [
          { id: "perm-1", resource: "content", action: "read" },
        ],
      } as never,
    });

    await expect(
      useCase.execute({ roleId: "role-1", permissionIds: ["perm-1"] }),
    ).resolves.toEqual([{ id: "perm-1", resource: "content", action: "read" }]);
  });

  test("ListPermissionsUseCase returns permissions", async () => {
    const useCase = new ListPermissionsUseCase({
      permissionRepository: {
        list: async () => [
          { id: "perm-1", resource: "content", action: "read" },
        ],
      } as never,
    });

    const result = await useCase.execute();
    expect(result.items).toEqual([
      { id: "perm-1", resource: "content", action: "read" },
    ]);
    expect(result.total).toBe(1);
  });

  test("GetUserRolesUseCase returns roles for user", async () => {
    const useCase = new GetUserRolesUseCase({
      userRepository: {
        findById: async (id: string) =>
          id === "user-1"
            ? { id: "user-1", email: "u@e.com", name: "U", isActive: true }
            : null,
      } as never,
      userRoleRepository: {
        listRolesByUserId: async () => [
          { userId: "user-1", roleId: "role-1" },
          { userId: "user-1", roleId: "role-2" },
        ],
      } as never,
      roleRepository: {
        findByIds: async (ids: string[]) =>
          ids.map((id) => ({
            id,
            name: id === "role-1" ? "Admin" : "Viewer",
            description: null,
            isSystem: false,
          })),
      } as never,
    });

    const result = await useCase.execute({ userId: "user-1" });
    expect(result.items).toHaveLength(2);
    expect(result.items.map((r) => r.name)).toEqual(["Admin", "Viewer"]);
    expect(result.total).toBe(2);
  });

  test("GetUserRolesUseCase throws when user missing", async () => {
    const useCase = new GetUserRolesUseCase({
      userRepository: { findById: async () => null } as never,
      userRoleRepository: { listRolesByUserId: async () => [] } as never,
      roleRepository: { findByIds: async () => [] } as never,
    });

    await expect(useCase.execute({ userId: "missing" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("GetRoleUsersUseCase returns users for role", async () => {
    const useCase = new GetRoleUsersUseCase({
      roleRepository: {
        findById: async (id: string) =>
          id === "role-1"
            ? {
                id: "role-1",
                name: "Admin",
                description: null,
                isSystem: false,
              }
            : null,
      } as never,
      userRoleRepository: {
        listUserIdsByRoleId: async () => ["user-1", "user-2"],
      } as never,
      userRepository: {
        findByIds: async (ids: string[]) =>
          ids.map((id) => ({
            id,
            email: `${id}@e.com`,
            name: id,
            isActive: true,
          })),
      } as never,
    });

    const result = await useCase.execute({ roleId: "role-1" });
    expect(result.items).toHaveLength(2);
    expect(result.items.map((u) => u.id)).toEqual(["user-1", "user-2"]);
    expect(result.total).toBe(2);
  });

  test("GetRoleUsersUseCase throws when role missing", async () => {
    const useCase = new GetRoleUsersUseCase({
      roleRepository: { findById: async () => null } as never,
      userRoleRepository: { listUserIdsByRoleId: async () => [] } as never,
      userRepository: { findByIds: async () => [] } as never,
    });

    await expect(useCase.execute({ roleId: "missing" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
