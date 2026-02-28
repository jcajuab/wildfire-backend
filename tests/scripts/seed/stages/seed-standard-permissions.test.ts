import { describe, expect, test } from "bun:test";
import { STANDARD_RESOURCE_ACTIONS } from "../../../../scripts/seed/constants";
import { type SeedContext } from "../../../../scripts/seed/stage-types";
import { runSeedStandardPermissions } from "../../../../scripts/seed/stages/seed-standard-permissions";

const unused = () => {
  throw new Error("unused in this test");
};

const makeContext = (dryRun = false): SeedContext => {
  const store = {
    permissions: [] as Array<{ id: string; resource: string; action: string }>,
  };

  let seq = 0;

  const ctx: SeedContext = {
    args: {
      mode: "baseline",
      dryRun,
      strict: false,
    },
    targetEmail: "alice@example.com",
    htshadowPath: "/tmp/unused",
    repos: {
      permissionRepository: {
        list: async () => [...store.permissions],
        findByIds: async (ids: string[]) =>
          store.permissions.filter((permission) => ids.includes(permission.id)),
        create: async (input: { resource: string; action: string }) => {
          seq += 1;
          const created = {
            id: `perm-${seq}`,
            resource: input.resource,
            action: input.action,
          };
          store.permissions.push(created);
          return created;
        },
      },
      roleRepository: {
        list: unused,
        findById: unused,
        findByIds: unused,
        create: unused,
        update: unused,
        delete: unused,
      },
      rolePermissionRepository: {
        listPermissionsByRoleId: unused,
        setRolePermissions: unused,
      },
      userRepository: {
        list: unused,
        findById: unused,
        findByIds: unused,
        findByEmail: unused,
        create: unused,
        update: unused,
        delete: unused,
      },
      userRoleRepository: {
        listRolesByUserId: unused,
        listUserIdsByRoleId: unused,
        listUserCountByRoleIds: unused,
        setUserRoles: unused,
      },
    },
    io: {
      hashPassword: unused,
      writeFile: unused,
    },
  };

  return ctx;
};

describe("runSeedStandardPermissions", () => {
  test("creates full standard permission matrix", async () => {
    const ctx = makeContext(false);

    const result = await runSeedStandardPermissions(ctx);

    expect(result.created).toBe(STANDARD_RESOURCE_ACTIONS.length);
    expect(result.skipped).toBe(0);

    const secondRun = await runSeedStandardPermissions(ctx);
    expect(secondRun.created).toBe(0);
    expect(secondRun.skipped).toBe(STANDARD_RESOURCE_ACTIONS.length);
  });

  test("dry-run reports creates without writing", async () => {
    const ctx = makeContext(true);

    const result = await runSeedStandardPermissions(ctx);
    expect(result.created).toBe(STANDARD_RESOURCE_ACTIONS.length);

    const secondRun = await runSeedStandardPermissions(ctx);
    expect(secondRun.created).toBe(STANDARD_RESOURCE_ACTIONS.length);
    expect(secondRun.skipped).toBe(0);
  });
});
