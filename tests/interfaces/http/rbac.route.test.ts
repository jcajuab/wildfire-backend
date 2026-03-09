import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  type PermissionRecord,
  type RoleRecord,
  type UserRecord,
} from "#/application/ports/rbac";
import { createRbacHttpModule } from "#/bootstrap/http/modules";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import {
  createRbacRouter,
  type RbacRouterDeps,
} from "#/interfaces/http/routes/rbac.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const parseJson = async <T>(response: Response) => (await response.json()) as T;

const rootRoleId = "11111111-1111-4111-8111-111111111111";
const rootUserId = "22222222-2222-4222-8222-222222222222";
const authSessionRepository = {
  create: async () => {},
  extendExpiry: async () => {},
  revokeById: async () => {},
  revokeAllForUser: async () => {},
  isActive: async () => true,
  isOwnedByUser: async () => true,
};

const makePermissionId = (index: number): string =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

const buildApp = (grantedPermissions: string[]) => {
  const counters = {
    listRolesByUserIdCalls: 0,
    listRolesByUserIdsCalls: 0,
  };
  const store: {
    users: UserRecord[];
    roles: RoleRecord[];
    permissions: PermissionRecord[];
    userRoles: Array<{ userId: string; roleId: string }>;
    rolePermissions: Array<{ roleId: string; permissionId: string }>;
  } = {
    users: [
      {
        id: rootUserId,
        username: "admin",
        email: "admin@example.com",
        name: "Admin",
        isActive: true,
      },
    ],
    roles: [
      {
        id: rootRoleId,
        name: "Root",
        description: "All access",
        isSystem: true,
      },
    ],
    permissions: [
      {
        id: "perm-root-access",
        resource: "root",
        action: "access",
        isRoot: true,
      },
      ...grantedPermissions.map((value, index) => {
        const [resource, action] = value.split(":");
        if (!resource || !action) {
          throw new Error(`Invalid permission: ${value}`);
        }
        return {
          id: makePermissionId(index),
          resource,
          action,
          isRoot: false,
        };
      }),
    ],
    userRoles: [{ userId: rootUserId, roleId: rootRoleId }],
    rolePermissions: [] as Array<{ roleId: string; permissionId: string }>,
  };

  store.rolePermissions.push(
    ...store.permissions.map((permission) => ({
      roleId: rootRoleId,
      permissionId: permission.id,
    })),
  );

  const repositories: RbacRouterDeps["repositories"] = {
    userRepository: {
      list: async () => [...store.users],
      findById: async (id) =>
        store.users.find((user) => user.id === id) ?? null,
      findByIds: async (ids) =>
        store.users.filter((user) => ids.includes(user.id)),
      findByUsername: async (username) =>
        store.users.find((user) => user.username === username) ?? null,
      findByEmail: async (email) =>
        store.users.find((user) => user.email === email) ?? null,
      create: async (input) => {
        const created = {
          id: crypto.randomUUID(),
          username: input.username,
          email: input.email ?? null,
          name: input.name,
          isActive: input.isActive ?? true,
          timezone: null,
          avatarKey: null,
          lastSeenAt: null,
        };
        store.users.push(created);
        return created;
      },
      update: async (id, input) => {
        const user = store.users.find((item) => item.id === id);
        if (!user) return null;
        if (input.username !== undefined) user.username = input.username;
        if (input.email !== undefined) user.email = input.email ?? null;
        if (input.name !== undefined) user.name = input.name;
        if (input.isActive !== undefined) user.isActive = input.isActive;
        return user;
      },
      delete: async (id) => {
        const index = store.users.findIndex((user) => user.id === id);
        if (index < 0) return false;
        store.users.splice(index, 1);
        return true;
      },
    },
    roleRepository: {
      list: async () => [...store.roles],
      findById: async (id) =>
        store.roles.find((role) => role.id === id) ?? null,
      findByIds: async (ids) =>
        store.roles.filter((role) => ids.includes(role.id)),
      create: async (input) => {
        const created = {
          id: crypto.randomUUID(),
          name: input.name,
          description: input.description ?? null,
          isSystem: input.isSystem ?? false,
        };
        store.roles.push(created);
        return created;
      },
      update: async (id, input) => {
        const role = store.roles.find((item) => item.id === id);
        if (!role) return null;
        if (input.name !== undefined) role.name = input.name;
        if (input.description !== undefined)
          role.description = input.description ?? null;
        return role;
      },
      delete: async (id) => {
        const index = store.roles.findIndex((role) => role.id === id);
        if (index < 0) return false;
        store.roles.splice(index, 1);
        store.rolePermissions = store.rolePermissions.filter(
          (item) => item.roleId !== id,
        );
        store.userRoles = store.userRoles.filter((item) => item.roleId !== id);
        return true;
      },
    },
    permissionRepository: {
      list: async () => [...store.permissions],
      findByIds: async (ids) =>
        store.permissions.filter((permission) => ids.includes(permission.id)),
      create: async (input) => {
        const created = {
          id: crypto.randomUUID(),
          resource: input.resource,
          action: input.action,
          isRoot: input.isRoot ?? false,
        };
        store.permissions.push(created);
        return created;
      },
    },
    userRoleRepository: {
      listRolesByUserIds: async (userIds) => {
        counters.listRolesByUserIdsCalls += 1;
        return store.userRoles.filter((item) => userIds.includes(item.userId));
      },
      listRolesByUserId: async (userId) => {
        counters.listRolesByUserIdCalls += 1;
        return store.userRoles.filter((item) => item.userId === userId);
      },
      listUserIdsByRoleId: async (roleId) =>
        store.userRoles
          .filter((item) => item.roleId === roleId)
          .map((item) => item.userId),
      listUserCountByRoleIds: async (roleIds) =>
        Object.fromEntries(
          roleIds.map((roleId) => [
            roleId,
            store.userRoles.filter((item) => item.roleId === roleId).length,
          ]),
        ),
      setUserRoles: async (userId, roleIds) => {
        store.userRoles = store.userRoles.filter(
          (item) => item.userId !== userId,
        );
        store.userRoles.push(...roleIds.map((roleId) => ({ userId, roleId })));
      },
    },
    rolePermissionRepository: {
      listPermissionsByRoleId: async (roleId) =>
        store.rolePermissions.filter((item) => item.roleId === roleId),
      setRolePermissions: async (roleId, permissionIds) => {
        store.rolePermissions = store.rolePermissions.filter(
          (item) => item.roleId !== roleId,
        );
        store.rolePermissions.push(
          ...permissionIds.map((permissionId) => ({ roleId, permissionId })),
        );
      },
    },
    authorizationRepository: {
      findPermissionsForUser: async (userId) => {
        const roleIds = store.userRoles
          .filter((item) => item.userId === userId)
          .map((item) => item.roleId);
        const permissionIds = store.rolePermissions
          .filter((item) => roleIds.includes(item.roleId))
          .map((item) => item.permissionId);
        return store.permissions
          .filter(
            (permission) =>
              permissionIds.includes(permission.id) &&
              permission.isRoot !== true,
          )
          .map((permission) =>
            Permission.parse(`${permission.resource}:${permission.action}`),
          );
      },
      isRootUser: async (userId) => {
        const roleIds = store.userRoles
          .filter((item) => item.userId === userId)
          .map((item) => item.roleId);
        const permissionIds = store.rolePermissions
          .filter((item) => roleIds.includes(item.roleId))
          .map((item) => item.permissionId);
        return store.permissions.some(
          (permission) =>
            permissionIds.includes(permission.id) && permission.isRoot === true,
        );
      },
    },
  };

  const app = new Hono();
  app.route(
    "/",
    createRbacRouter(
      createRbacHttpModule({
        jwtSecret: "test-secret",
        authSessionRepository,
        authSessionCookieName: "wildfire_session_token",
        repositories,
      }),
    ),
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issueToken = async () =>
    tokenIssuer.issueToken({
      subject: rootUserId,
      username: "admin",
      email: "admin@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      sessionId: crypto.randomUUID(),
      issuer: undefined,
    });

  return { app, issueToken, store, counters };
};

describe("RBAC routes", () => {
  test("GET /roles returns list data envelope", async () => {
    const { app, issueToken } = buildApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request("/roles", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<{ id: string; name: string }>;
      meta: { total: number };
    }>(response);
    expect(body.meta.total).toBeGreaterThan(0);
    expect(body.data[0]?.name).toBe("Root");
  });

  test("POST /roles creates non-system role", async () => {
    const { app, issueToken } = buildApp(["roles:create"]);
    const token = await issueToken();

    const response = await app.request("/roles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Editor",
        description: "Can edit content",
      }),
    });

    expect(response.status).toBe(201);
    const body = await parseJson<{
      data: {
        id: string;
        name: string;
        isSystem: boolean;
      };
    }>(response);
    expect(body.data.name).toBe("Editor");
    expect(body.data.isSystem).toBe(false);
  });

  test("DELETE /roles/:id rejects deletion of system role", async () => {
    const { app, issueToken } = buildApp(["roles:delete"]);
    const token = await issueToken();

    const response = await app.request(`/roles/${rootRoleId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
  });

  test("PUT /roles/:id/permissions sets permissions for custom role", async () => {
    const { app, issueToken } = buildApp(["roles:create", "roles:update"]);
    const token = await issueToken();

    const createRoleResponse = await app.request("/roles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Playlist Manager" }),
    });
    expect(createRoleResponse.status).toBe(201);
    const createdRole = await parseJson<{ data: { id: string } }>(
      createRoleResponse,
    );

    const setPermissionsResponse = await app.request(
      `/roles/${createdRole.data.id}/permissions`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          permissionIds: [makePermissionId(0)],
        }),
      },
    );

    expect(setPermissionsResponse.status).toBe(200);
    const body = await parseJson<{
      data: Array<{ id: string }>;
    }>(setPermissionsResponse);
    expect(body.data).toHaveLength(1);
  });

  test("GET /users/:id/roles returns assigned roles", async () => {
    const { app, issueToken } = buildApp(["users:read"]);
    const token = await issueToken();

    const response = await app.request(`/users/${rootUserId}/roles`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<{ id: string; name: string }>;
      meta: { total: number };
    }>(response);
    expect(body.meta.total).toBe(1);
    expect(body.data[0]?.name).toBe("Root");
  });

  test("GET /roles/options returns filtered role options", async () => {
    const { app, issueToken } = buildApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request("/roles/options?q=roo&limit=1", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<{
        id: string;
        name: string;
        description: string | null;
        isSystem: boolean;
      }>;
    }>(response);
    expect(body.data).toEqual([
      {
        id: rootRoleId,
        name: "Root",
        description: "All access",
        isSystem: true,
      },
    ]);
  });

  test("GET /users/options returns filtered user options", async () => {
    const { app, issueToken } = buildApp(["users:read"]);
    const token = await issueToken();

    const response = await app.request("/users/options?q=admin&limit=1", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<{
        id: string;
        username: string;
        email: string | null;
        name: string;
      }>;
    }>(response);
    expect(body.data).toEqual([
      {
        id: rootUserId,
        username: "admin",
        email: "admin@example.com",
        name: "Admin",
      },
    ]);
  });

  test("GET /permissions/options returns filtered permission options", async () => {
    const { app, issueToken } = buildApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request("/permissions/options?q=read", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<{
        id: string;
        resource: string;
        action: string;
        isRoot?: boolean;
      }>;
    }>(response);
    expect(body.data).toEqual([
      {
        id: makePermissionId(0),
        resource: "roles",
        action: "read",
        isRoot: false,
      },
    ]);
  });

  test("GET /permissions filters by q", async () => {
    const { app, issueToken } = buildApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request("/permissions?q=read", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<{
        id: string;
        resource: string;
        action: string;
        isRoot?: boolean;
      }>;
      meta: { total: number };
    }>(response);
    expect(body.meta.total).toBe(1);
    expect(body.data).toEqual([
      {
        id: makePermissionId(0),
        resource: "roles",
        action: "read",
        isRoot: false,
      },
    ]);
  });

  test("GET /users sorts by lastSeenAt desc and uses bulk role enrichment", async () => {
    const { app, issueToken, store, counters } = buildApp(["users:read"]);
    store.users.push(
      {
        id: "33333333-3333-4333-8333-333333333333",
        username: "older",
        email: "older@example.com",
        name: "Older User",
        isActive: true,
        lastSeenAt: "2025-01-01T00:00:00.000Z",
        avatarKey: null,
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        username: "newer",
        email: "newer@example.com",
        name: "Newer User",
        isActive: true,
        lastSeenAt: "2025-02-01T00:00:00.000Z",
        avatarKey: null,
      },
    );
    store.roles.push({
      id: "55555555-5555-4555-8555-555555555555",
      name: "Viewer",
      description: null,
      isSystem: false,
    });
    store.userRoles.push({
      userId: "44444444-4444-4444-8444-444444444444",
      roleId: "55555555-5555-4555-8555-555555555555",
    });

    const token = await issueToken();
    const response = await app.request(
      "/users?sortBy=lastSeenAt&sortDirection=desc&page=1&pageSize=10",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<{
        id: string;
        roles: Array<{ id: string; name: string }>;
      }>;
    }>(response);
    expect(body.data.map((user) => user.id)).toEqual([
      "44444444-4444-4444-8444-444444444444",
      "33333333-3333-4333-8333-333333333333",
      rootUserId,
    ]);
    expect(body.data[0]?.roles).toEqual([
      {
        id: "55555555-5555-4555-8555-555555555555",
        name: "Viewer",
      },
    ]);
    expect(counters.listRolesByUserIdsCalls).toBe(1);
    expect(counters.listRolesByUserIdCalls).toBe(0);
  });
});
