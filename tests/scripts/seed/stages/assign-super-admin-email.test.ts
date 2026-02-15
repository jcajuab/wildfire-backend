import { describe, expect, test } from "bun:test";
import { SUPER_ADMIN_ROLE_NAME } from "../../../../scripts/seed/constants";
import { type SeedContext } from "../../../../scripts/seed/stage-types";
import { runAssignSuperAdminEmail } from "../../../../scripts/seed/stages/assign-super-admin-email";

const makeContext = (input: {
  targetEmail?: string;
  strict?: boolean;
  dryRun?: boolean;
}) => {
  const users = [
    { id: "user-1", email: "user@example.com", name: "User", isActive: true },
  ];
  const roles = [
    {
      id: "role-1",
      name: SUPER_ADMIN_ROLE_NAME,
      description: "All access",
      isSystem: true,
    },
  ];
  const assignments = new Map<string, string[]>();
  const firstRole = roles[0];
  const firstUser = users[0];

  if (!firstRole || !firstUser) {
    throw new Error("Test setup requires at least one role and user");
  }

  const ctx: SeedContext = {
    args: {
      mode: "baseline",
      dryRun: input.dryRun ?? false,
      strict: input.strict ?? false,
    },
    targetEmail: input.targetEmail,
    htshadowPath: "/tmp/unused",
    repos: {
      permissionRepository: {
        list: async () => [],
        findByIds: async () => [],
        create: async () => ({ id: "x", resource: "x", action: "x" }),
      },
      roleRepository: {
        list: async () => roles,
        findById: async (id: string) =>
          roles.find((role) => role.id === id) ?? null,
        findByIds: async (ids: string[]) =>
          roles.filter((role) => ids.includes(role.id)),
        create: async () => firstRole,
        update: async () => null,
        delete: async () => false,
      },
      rolePermissionRepository: {
        listPermissionsByRoleId: async () => [],
        setRolePermissions: async () => {},
      },
      userRepository: {
        list: async () => users,
        findById: async (id: string) =>
          users.find((user) => user.id === id) ?? null,
        findByIds: async (ids: string[]) =>
          users.filter((user) => ids.includes(user.id)),
        findByEmail: async (email: string) =>
          users.find((user) => user.email === email) ?? null,
        create: async () => firstUser,
        update: async () => null,
        delete: async () => false,
      },
      userRoleRepository: {
        listRolesByUserId: async (userId: string) =>
          (assignments.get(userId) ?? []).map((roleId) => ({ userId, roleId })),
        listUserIdsByRoleId: async () => [],
        listUserCountByRoleIds: async () => ({}),
        setUserRoles: async (userId: string, roleIds: string[]) => {
          assignments.set(userId, roleIds);
        },
      },
    },
    io: {
      hashPassword: async () => "",
      writeFile: async () => {},
    },
  };

  return { ctx, assignments };
};

describe("runAssignSuperAdminEmail", () => {
  test("skips when no target email", async () => {
    const { ctx } = makeContext({});
    const result = await runAssignSuperAdminEmail(ctx);

    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
  });

  test("throws in strict mode when user is missing", async () => {
    const { ctx } = makeContext({
      targetEmail: "missing@example.com",
      strict: true,
    });

    await expect(runAssignSuperAdminEmail(ctx)).rejects.toThrow(
      "Target user not found: missing@example.com",
    );
  });

  test("assigns super admin role to target user", async () => {
    const { ctx, assignments } = makeContext({
      targetEmail: "user@example.com",
    });

    const result = await runAssignSuperAdminEmail(ctx);

    expect(result.updated).toBe(1);
    expect(assignments.get("user-1")).toEqual(["role-1"]);
  });
});
