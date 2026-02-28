import { describe, expect, test } from "bun:test";
import {
  ROOT_PERMISSION,
  ROOT_ROLE_NAME,
} from "../../../../scripts/seed/constants";
import { type SeedContext } from "../../../../scripts/seed/stage-types";
import { runSeedRoot } from "../../../../scripts/seed/stages/seed-root";

const unused = () => {
  throw new Error("unused in this test");
};

describe("runSeedRoot", () => {
  test("creates root role, root permission, root user, and credentials", async () => {
    const state = {
      roles: [] as Array<{
        id: string;
        name: string;
        description: string | null;
        isSystem: boolean;
      }>,
      permissions: [] as Array<{
        id: string;
        resource: string;
        action: string;
        isRoot?: boolean;
      }>,
      users: [] as Array<{
        id: string;
        email: string;
        name: string;
        isActive: boolean;
      }>,
      userAssignments: new Map<string, string[]>(),
      roleAssignments: new Map<string, string[]>(),
      htshadow: "",
      roleSeq: 1,
      permissionSeq: 1,
      userSeq: 1,
      setRolePermissionsCalls: 0,
      setUserRolesCalls: 0,
    };

    const rootUserEmail = "admin@example.com";

    const ctx: SeedContext = {
      args: {
        dryRun: false,
      },
      root: {
        user: rootUserEmail,
        password: "secret",
      },
      htshadowPath: "/tmp/unused",
      repos: {
        permissionRepository: {
          list: async () => [...state.permissions],
          findByIds: async () => [],
          create: async () => {
            const permission = {
              id: `permission-${state.permissionSeq++}`,
              ...ROOT_PERMISSION,
            };
            state.permissions.push(permission);
            return permission;
          },
          updateIsRoot: async () => {},
        },
        roleRepository: {
          list: async () => state.roles,
          findById: async () => null,
          findByIds: async () => [],
          create: async () => {
            const role = {
              id: `role-${state.roleSeq++}`,
              name: ROOT_ROLE_NAME,
              description: null,
              isSystem: true,
            };
            state.roles.push(role);
            return role;
          },
          update: async () => null,
          delete: async () => false,
        },
        rolePermissionRepository: {
          listPermissionsByRoleId: async (roleId: string) => {
            const permissions = state.roleAssignments.get(roleId) ?? [];
            return permissions.map((permissionId) => ({
              roleId,
              permissionId,
            }));
          },
          setRolePermissions: async (
            roleId: string,
            permissionIds: string[],
          ) => {
            state.setRolePermissionsCalls += 1;
            state.roleAssignments.set(roleId, permissionIds);
          },
        },
        userRepository: {
          list: async () => state.users,
          findById: async () => null,
          findByIds: async () => [],
          findByEmail: async (email: string) => {
            return state.users.find((user) => user.email === email) ?? null;
          },
          create: async ({ email }) => {
            const user = {
              id: `user-${state.userSeq++}`,
              email,
              name: "Admin",
              isActive: true,
            };
            state.users.push(user);
            return user;
          },
          update: async () => null,
          delete: async () => false,
        },
        userRoleRepository: {
          listRolesByUserId: async (userId: string) =>
            (state.userAssignments.get(userId) ?? []).map((roleId) => ({
              userId,
              roleId,
            })),
          listUserIdsByRoleId: async () => [],
          listUserCountByRoleIds: async () => ({}),
          setUserRoles: async (userId: string, roleIds: string[]) => {
            state.setUserRolesCalls += 1;
            state.userAssignments.set(userId, roleIds);
          },
        },
      },
      io: {
        readFile: async () => state.htshadow,
        hashPassword: async () => "hash-1",
        writeFile: async (_path, data) => {
          state.htshadow = data;
        },
      },
    };

    const result = await runSeedRoot(ctx);

    expect(result.created).toBe(3);
    expect(result.updated).toBe(3);
    expect(result.skipped).toBe(0);
    expect(state.setRolePermissionsCalls).toBe(1);
    expect(state.setUserRolesCalls).toBe(1);
    expect(state.htshadow).toContain(`${rootUserEmail}:hash-1`);
  });

  test("updates existing root credentials and preserves extra roles", async () => {
    const preExistingRootRole = {
      id: "root-role",
      name: ROOT_ROLE_NAME,
      description: "existing",
      isSystem: true,
    };
    const preExistingRole = {
      id: "viewer-role",
      name: "Viewer",
      description: null,
      isSystem: false,
    };
    const preExistingUser = {
      id: "root-user",
      email: "admin@example.com",
      name: "Admin",
      isActive: true,
    };

    const state = {
      roles: [preExistingRole, preExistingRootRole],
      permissions: [
        {
          id: "root-permission",
          resource: "root",
          action: "access",
          isRoot: true,
        },
      ],
      users: [preExistingUser],
      roleAssignments: new Map([
        [preExistingRootRole.id, ["other-permission", "root-permission"]],
      ]),
      userAssignments: new Map([[preExistingUser.id, [preExistingRole.id]]]),
      htshadow: "admin@example.com:old-hash\na@b.com:other\n",
      hash: "new-hash",
      setRolePermissionsCalls: 0,
      setUserRolesCalls: 0,
    };

    const ctx: SeedContext = {
      args: {
        dryRun: false,
      },
      root: {
        user: preExistingUser.email,
        password: "new-password",
      },
      htshadowPath: "/tmp/unused",
      repos: {
        permissionRepository: {
          list: async () => [...state.permissions],
          findByIds: async () => [],
          create: unused,
          updateIsRoot: async () => {},
        },
        roleRepository: {
          list: async () => state.roles,
          findById: async () => null,
          findByIds: async () => [],
          create: unused,
          update: async () => null,
          delete: async () => false,
        },
        rolePermissionRepository: {
          listPermissionsByRoleId: async (roleId: string) => {
            const permissions = state.roleAssignments.get(roleId) ?? [];
            return permissions.map((permissionId) => ({
              roleId,
              permissionId,
            }));
          },
          setRolePermissions: async () => {
            state.setRolePermissionsCalls += 1;
          },
        },
        userRepository: {
          list: async () => state.users,
          findById: async () => null,
          findByIds: async () => [],
          findByEmail: async (email: string) =>
            state.users.find((user) => user.email === email) ?? null,
          create: unused,
          update: async () => null,
          delete: async () => false,
        },
        userRoleRepository: {
          listRolesByUserId: async (userId: string) => {
            const roleIds = state.userAssignments.get(userId) ?? [];
            return roleIds.map((roleId) => ({ userId, roleId }));
          },
          listUserIdsByRoleId: async () => [],
          listUserCountByRoleIds: async () => ({}),
          setUserRoles: async (userId: string, roleIds: string[]) => {
            state.setUserRolesCalls += 1;
            state.userAssignments.set(userId, roleIds);
          },
        },
      },
      io: {
        readFile: async () => state.htshadow,
        hashPassword: async () => state.hash,
        writeFile: async (_path, data) => {
          state.htshadow = data;
        },
      },
    };

    const result = await runSeedRoot(ctx);
    const rootUserLines = state.htshadow
      .split("\n")
      .filter((line) => line.startsWith(`${preExistingUser.email}:`));

    expect(result.updated).toBe(2);
    expect(result.skipped).toBe(4);
    expect(state.setRolePermissionsCalls).toBe(0);
    expect(state.setUserRolesCalls).toBe(1);
    expect(rootUserLines[0]).toBe(`${preExistingUser.email}:${state.hash}`);
  });
});
