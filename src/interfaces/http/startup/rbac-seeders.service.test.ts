import { describe, expect, test } from "bun:test";
import {
  type PermissionRecord,
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRecord,
  type RoleRepository,
} from "#/application/ports/rbac";
import { canonicalPermissionKey } from "#/domain/rbac/canonical-permissions";
import { PREDEFINED_SYSTEM_ROLE_TEMPLATES } from "#/domain/rbac/system-role-templates";
import { ensurePredefinedSystemRoles } from "./rbac-seeders.service";

const buildPermissionRecords = (): PermissionRecord[] => {
  const permissionKeys = new Set(
    PREDEFINED_SYSTEM_ROLE_TEMPLATES.flatMap((template) =>
      template.permissionKeys.map((key) => key),
    ),
  );

  return [...permissionKeys].map((key) => {
    const [resource, action] = key.split(":");
    if (!resource || !action) {
      throw new Error(`Invalid permission key in test fixture: ${key}`);
    }

    return {
      id: `permission:${key}`,
      resource,
      action,
      isAdmin: false,
    };
  });
};

const findTemplate = (name: string) => {
  const template =
    PREDEFINED_SYSTEM_ROLE_TEMPLATES.find((item) => item.name === name) ?? null;
  if (!template) {
    throw new Error(`Missing predefined system role template: ${name}`);
  }
  return template;
};

describe("predefined RBAC system roles", () => {
  test("gives the default Editor role AI access", () => {
    const editorTemplate = findTemplate("Editor");

    expect(editorTemplate.permissionKeys).toContain("ai:access");
  });

  test("reconciles an existing Editor role that is missing AI access", async () => {
    const permissions = buildPermissionRecords();
    const permissionIdByKey = new Map(
      permissions.map((permission) => [
        canonicalPermissionKey(permission),
        permission.id,
      ]),
    );

    const editorTemplate = findTemplate("Editor");
    const viewerTemplate = findTemplate("Viewer");
    const roles: RoleRecord[] = [
      {
        id: "role:editor",
        name: "Editor",
        description: editorTemplate.description,
        isSystem: true,
      },
      {
        id: "role:viewer",
        name: "Viewer",
        description: viewerTemplate.description,
        isSystem: true,
      },
    ];

    const assignmentsByRoleId = new Map<string, string[]>([
      [
        "role:editor",
        editorTemplate.permissionKeys
          .filter((key) => key !== "ai:access")
          .map((key) => {
            const permissionId = permissionIdByKey.get(key);
            if (!permissionId) throw new Error(`Missing permission ${key}`);
            return permissionId;
          }),
      ],
      [
        "role:viewer",
        viewerTemplate.permissionKeys.map((key) => {
          const permissionId = permissionIdByKey.get(key);
          if (!permissionId) throw new Error(`Missing permission ${key}`);
          return permissionId;
        }),
      ],
    ]);
    const setPermissionCalls: Array<{
      roleId: string;
      permissionIds: string[];
    }> = [];

    const roleRepository: RoleRepository = {
      list: async () => roles,
      findById: async () => null,
      findByIds: async () => [],
      findByName: async () => null,
      create: async () => {
        throw new Error("Roles should already exist in this test.");
      },
      update: async () => {
        throw new Error("Role descriptions should already match in this test.");
      },
      delete: async () => false,
    };
    const permissionRepository: PermissionRepository = {
      list: async () => permissions,
      findByIds: async () => [],
      create: async () => {
        throw new Error("Permissions should already exist in this test.");
      },
    };
    const rolePermissionRepository: RolePermissionRepository = {
      listPermissionsByRoleId: async (roleId) =>
        (assignmentsByRoleId.get(roleId) ?? []).map((permissionId) => ({
          roleId,
          permissionId,
        })),
      setRolePermissions: async (roleId, permissionIds) => {
        setPermissionCalls.push({ roleId, permissionIds });
        assignmentsByRoleId.set(roleId, permissionIds);
      },
    };

    const result = await ensurePredefinedSystemRoles({
      roleRepository,
      permissionRepository,
      rolePermissionRepository,
    });

    expect(result.reconciledSystemRolePermissionSets).toBe(1);
    expect(setPermissionCalls).toHaveLength(1);
    expect(setPermissionCalls[0]?.roleId).toBe("role:editor");
    expect(setPermissionCalls[0]?.permissionIds).toContain(
      "permission:ai:access",
    );
  });
});
