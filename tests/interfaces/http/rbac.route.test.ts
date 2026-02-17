import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type ContentStorage } from "#/application/ports/content";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createRbacRouter } from "#/interfaces/http/routes/rbac.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const roleId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
/** Second user (no roles) for tests that assign non-system roles. */
const userIdNoRoles = "33333333-3333-4333-8333-333333333333";
/** Editor role (non-system) for tests where caller has users:update but is not Super Admin. */
const editorRoleId = "44444444-4444-4444-8444-444444444444";
const parseJson = async <T>(response: Response) => (await response.json()) as T;

/** Builds app with a second user (userIdNoRoles) who has only users:update via Editor role. Use issueTokenForEditor() to get a token for that user. */
function buildAppWithEditorUser(): {
  app: Hono;
  issueToken: () => Promise<string>;
  issueTokenForEditor: () => Promise<string>;
} {
  const { store, repositories } = makeStore();
  store.roles.push({
    id: editorRoleId,
    name: "Editor",
    description: "Can edit",
    isSystem: false,
  });
  const permUpdate = {
    id: "perm-users-update",
    resource: "users",
    action: "update",
  };
  const permDelete = {
    id: "perm-users-delete",
    resource: "users",
    action: "delete",
  };
  store.permissions.push(permUpdate, permDelete);
  store.rolePermissions.push(
    { roleId: editorRoleId, permissionId: permUpdate.id },
    { roleId: editorRoleId, permissionId: permDelete.id },
  );
  store.userRoles.push({ userId: userIdNoRoles, roleId: editorRoleId });

  const rbacRouter = createRbacRouter({
    jwtSecret: "test-secret",
    repositories,
  });
  const app = new Hono();
  app.route("/", rbacRouter);

  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    app,
    issueToken: async () =>
      tokenIssuer.issueToken({
        subject: userId,
        issuedAt: nowSeconds,
        expiresAt: nowSeconds + 3600,
        issuer: undefined,
        email: "admin@example.com",
      }),
    issueTokenForEditor: async () =>
      tokenIssuer.issueToken({
        subject: userIdNoRoles,
        issuedAt: nowSeconds,
        expiresAt: nowSeconds + 3600,
        issuer: undefined,
        email: "noroles@example.com",
      }),
  };
}

const makeStore = () => {
  const store = {
    users: [] as Array<{
      id: string;
      email: string;
      name: string;
      isActive: boolean;
      avatarKey?: string | null;
    }>,
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
    }>,
    userRoles: [] as Array<{ userId: string; roleId: string }>,
    rolePermissions: [] as Array<{ roleId: string; permissionId: string }>,
  };

  store.users.push({
    id: userId,
    email: "admin@example.com",
    name: "Admin",
    isActive: true,
  });
  store.users.push({
    id: userIdNoRoles,
    email: "noroles@example.com",
    name: "No Roles User",
    isActive: true,
  });
  store.roles.push({
    id: roleId,
    name: "Super Admin",
    description: "All access",
    isSystem: true,
  });
  store.permissions.push(
    { id: "perm-1", resource: "*", action: "manage" },
    { id: "perm-2", resource: "roles", action: "read" },
    { id: "perm-3", resource: "roles", action: "create" },
    { id: "perm-4", resource: "users", action: "read" },
  );
  store.userRoles.push({ userId, roleId });
  store.rolePermissions.push({ roleId, permissionId: "perm-1" });

  const repositories = {
    userRepository: {
      list: async () => [...store.users],
      findById: async (id: string) =>
        store.users.find((user) => user.id === id) ?? null,
      findByIds: async (ids: string[]) =>
        store.users.filter((user) => ids.includes(user.id)),
      findByEmail: async (email: string) =>
        store.users.find((user) => user.email === email) ?? null,
      create: async (data: {
        email: string;
        name: string;
        isActive: boolean;
      }) => {
        const user = {
          id: `user-${store.users.length + 1}`,
          ...data,
        };
        store.users.push(user);
        return user;
      },
      update: async (
        id: string,
        data: {
          email?: string;
          name?: string;
          isActive?: boolean;
          avatarKey?: string | null;
        },
      ) => {
        const user = store.users.find((item) => item.id === id);
        if (!user) return null;
        Object.assign(user, data);
        return user;
      },
      delete: async (id: string) => {
        const index = store.users.findIndex((user) => user.id === id);
        if (index === -1) return false;
        store.users.splice(index, 1);
        return true;
      },
    },
    roleRepository: {
      list: async () => [...store.roles],
      findById: async (id: string) =>
        store.roles.find((role) => role.id === id) ?? null,
      findByIds: async (ids: string[]) =>
        store.roles.filter((role) => ids.includes(role.id)),
      create: async (data: {
        name: string;
        description?: string | null;
        isSystem?: boolean;
      }) => {
        const role = {
          id: crypto.randomUUID(),
          name: data.name,
          description: data.description ?? null,
          isSystem: data.isSystem ?? false,
        };
        store.roles.push(role);
        return role;
      },
      update: async (
        id: string,
        data: { name?: string; description?: string },
      ) => {
        const role = store.roles.find((item) => item.id === id);
        if (!role) return null;
        if (data.name !== undefined) role.name = data.name;
        if (data.description !== undefined)
          role.description = data.description ?? null;
        return role;
      },
      delete: async (id: string) => {
        const index = store.roles.findIndex((role) => role.id === id);
        if (index === -1) return false;
        store.roles.splice(index, 1);
        return true;
      },
    },
    permissionRepository: {
      list: async () => [...store.permissions],
      findByIds: async (ids: string[]) =>
        store.permissions.filter((permission) => ids.includes(permission.id)),
      create: async (data: { resource: string; action: string }) => {
        const permission = {
          id: `perm-${store.permissions.length + 1}`,
          resource: data.resource,
          action: data.action,
        };
        store.permissions.push(permission);
        return permission;
      },
    },
    userRoleRepository: {
      listRolesByUserId: async (userId: string) =>
        store.userRoles.filter((item) => item.userId === userId),
      listUserIdsByRoleId: async (roleId: string) =>
        store.userRoles
          .filter((item) => item.roleId === roleId)
          .map((item) => item.userId),
      listUserCountByRoleIds: async (roleIds: string[]) => {
        const out: Record<string, number> = {};
        for (const rid of roleIds) {
          out[rid] = store.userRoles.filter(
            (item) => item.roleId === rid,
          ).length;
        }
        return out;
      },
      setUserRoles: async (userId: string, roleIds: string[]) => {
        store.userRoles = store.userRoles.filter(
          (item) => item.userId !== userId,
        );
        store.userRoles.push(...roleIds.map((roleId) => ({ userId, roleId })));
      },
    },
    rolePermissionRepository: {
      listPermissionsByRoleId: async (roleId: string) =>
        store.rolePermissions.filter((item) => item.roleId === roleId),
      setRolePermissions: async (roleId: string, permissionIds: string[]) => {
        store.rolePermissions = store.rolePermissions.filter(
          (item) => item.roleId !== roleId,
        );
        store.rolePermissions.push(
          ...permissionIds.map((permissionId) => ({ roleId, permissionId })),
        );
      },
    },
    authorizationRepository: {
      findPermissionsForUser: async (userId: string) => {
        const roleIds = store.userRoles
          .filter((item) => item.userId === userId)
          .map((item) => item.roleId);
        const permissionIds = store.rolePermissions
          .filter((item) => roleIds.includes(item.roleId))
          .map((item) => item.permissionId);
        return store.permissions
          .filter((permission) => permissionIds.includes(permission.id))
          .map((permission) =>
            Permission.parse(`${permission.resource}:${permission.action}`),
          );
      },
    },
  };

  return { store, repositories };
};

const buildApp = (permissions: string[] = ["*:manage"]) => {
  const { store, repositories } = makeStore();

  if (!permissions.includes("*:manage")) {
    store.permissions = permissions.map((permission, index) => {
      const [resource, action] = permission.split(":");
      if (!resource || !action) {
        throw new Error(`Invalid permission: ${permission}`);
      }
      return {
        id: `perm-${index + 1}`,
        resource,
        action,
      };
    });
    store.rolePermissions = store.permissions.map((permission) => ({
      roleId,
      permissionId: permission.id,
    }));
  }

  const rbacRouter = createRbacRouter({
    jwtSecret: "test-secret",
    repositories,
  });

  const app = new Hono();
  app.route("/", rbacRouter);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issueToken = async () =>
    tokenIssuer.issueToken({
      subject: userId,
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      issuer: undefined,
      email: "admin@example.com",
    });

  return { app, issueToken };
};

/** Builds app with avatarStorage mock; store.users[0] is given avatarKey so GET /users and GET /users/:id return avatarUrl. */
function buildAppWithAvatarStorage(): {
  app: Hono;
  issueToken: () => Promise<string>;
  presignedUrl: string;
} {
  const { store, repositories } = makeStore();
  const presignedUrl = "https://presigned.example/avatar";
  (store.users[0] as { avatarKey?: string }).avatarKey = `avatars/${userId}`;

  const avatarStorage: ContentStorage = {
    upload: async () => {},
    delete: async () => {},
    getPresignedDownloadUrl: async () => presignedUrl,
  };

  const rbacRouter = createRbacRouter({
    jwtSecret: "test-secret",
    repositories,
    avatarStorage,
    avatarUrlExpiresInSeconds: 3600,
  });
  const app = new Hono();
  app.route("/", rbacRouter);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issueToken = async () =>
    tokenIssuer.issueToken({
      subject: userId,
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      issuer: undefined,
      email: "admin@example.com",
    });

  return { app, issueToken, presignedUrl };
}

describe("RBAC routes", () => {
  test("GET /roles returns roles when authorized", async () => {
    const { app, issueToken } = buildApp();
    const token = await issueToken();

    const response = await app.request("/roles", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      items: Array<{ name: string }>;
      total: number;
    }>(response);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.name).toBe("Super Admin");
  });

  test("POST /roles creates a role", async () => {
    const { app, issueToken } = buildApp(["roles:create"]);
    const token = await issueToken();

    const response = await app.request("/roles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Content Manager" }),
    });

    expect(response.status).toBe(201);
    const body = await parseJson<{ name: string }>(response);
    expect(body.name).toBe("Content Manager");
  });

  test("GET /roles/:id returns role details", async () => {
    const { app, issueToken } = buildApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request(`/roles/${roleId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{ id: string }>(response);
    expect(body.id).toBe(roleId);
  });

  test("GET /roles/:id returns 400 for invalid id", async () => {
    const { app, issueToken } = buildApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request("/roles/not-a-uuid", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(400);
  });

  test("PATCH /roles/:id returns 403 for system role", async () => {
    const { app, issueToken } = buildApp(["roles:update"]);
    const token = await issueToken();

    const response = await app.request(`/roles/${roleId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ description: "Updated" }),
    });

    expect(response.status).toBe(403);
    const body = await parseJson<{ error: { code: string; message: string } }>(
      response,
    );
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toContain("system role");
  });

  test("PATCH /roles/:id updates non-system role", async () => {
    const { app, issueToken } = buildApp(["roles:update", "roles:create"]);
    const token = await issueToken();

    const createRes = await app.request("/roles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Custom Role",
        description: "To update",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<{ id: string }>(createRes);
    const customRoleId = created.id;

    const response = await app.request(`/roles/${customRoleId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ description: "Updated" }),
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{ description: string | null }>(response);
    expect(body.description).toBe("Updated");
  });

  test("DELETE /roles/:id returns 403 for system role", async () => {
    const { app, issueToken } = buildApp(["roles:delete"]);
    const token = await issueToken();

    const response = await app.request(`/roles/${roleId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
    const body = await parseJson<{ error: { code: string; message: string } }>(
      response,
    );
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toContain("system role");
  });

  test("DELETE /roles/:id removes non-system role", async () => {
    const { app, issueToken } = buildApp(["roles:delete", "roles:create"]);
    const token = await issueToken();

    const createRes = await app.request("/roles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Custom Role", description: "To delete" }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<{ id: string }>(createRes);
    const customRoleId = created.id;

    const response = await app.request(`/roles/${customRoleId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(204);
  });

  test("GET /roles/:id/permissions returns permissions", async () => {
    const { app, issueToken } = buildApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request(`/roles/${roleId}/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<Array<{ id: string }>>(response);
    expect(body.length).toBeGreaterThan(0);
  });

  test("PUT /roles/:id/permissions returns 403 for system role", async () => {
    const { app, issueToken } = buildApp(["roles:update"]);
    const token = await issueToken();

    const response = await app.request(`/roles/${roleId}/permissions`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ permissionIds: ["perm-1"] }),
    });

    expect(response.status).toBe(403);
    const body = await parseJson<{ error: { code: string; message: string } }>(
      response,
    );
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toContain("system role");
  });

  test("PUT /roles/:id/permissions sets permissions for non-system role", async () => {
    const { app, issueToken } = buildApp(["roles:update", "roles:create"]);
    const token = await issueToken();

    const createRes = await app.request("/roles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Custom Role",
        description: "To set permissions",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<{ id: string }>(createRes);
    const customRoleId = created.id;

    const response = await app.request(`/roles/${customRoleId}/permissions`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ permissionIds: ["perm-2"] }),
    });

    expect(response.status).toBe(200);
    const body = await parseJson<Array<{ id: string }>>(response);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]?.id).toBe("perm-2");
  });

  test("GET /roles/:id/users returns users assigned to role", async () => {
    const { app, issueToken } = buildApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request(`/roles/${roleId}/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<Array<{ id: string }>>(response);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]?.id).toBe(userId);
  });

  test("GET /permissions returns permissions", async () => {
    const { app, issueToken } = buildApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request("/permissions", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      items: Array<{ id: string }>;
      total: number;
    }>(response);
    expect(body.items.length).toBeGreaterThan(0);
  });

  test("GET /users returns users", async () => {
    const { app, issueToken } = buildApp(["users:read"]);
    const token = await issueToken();

    const response = await app.request("/users", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      items: Array<{ email: string }>;
      total: number;
    }>(response);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.email).toBe("admin@example.com");
  });

  test("GET /users returns avatarUrl and omits avatarKey when avatarStorage is provided", async () => {
    const { app, issueToken, presignedUrl } = buildAppWithAvatarStorage();
    const token = await issueToken();

    const response = await app.request("/users", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      items: Array<{
        id: string;
        email: string;
        avatarUrl?: string;
        avatarKey?: string;
      }>;
      total: number;
    }>(response);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.avatarUrl).toBe(presignedUrl);
    expect(body.items[0]).not.toHaveProperty("avatarKey");
  });

  test("GET /users/:id returns avatarUrl and omits avatarKey when avatarStorage is provided", async () => {
    const { app, issueToken, presignedUrl } = buildAppWithAvatarStorage();
    const token = await issueToken();

    const response = await app.request(`/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      id: string;
      avatarUrl?: string;
      avatarKey?: string;
    }>(response);
    expect(body.id).toBe(userId);
    expect(body.avatarUrl).toBe(presignedUrl);
    expect(body).not.toHaveProperty("avatarKey");
  });

  test("POST /users creates a user", async () => {
    const { app, issueToken } = buildApp(["users:create"]);
    const token = await issueToken();

    const response = await app.request("/users", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "new@example.com",
        name: "New User",
      }),
    });

    expect(response.status).toBe(201);
    const body = await parseJson<{ email: string }>(response);
    expect(body.email).toBe("new@example.com");
  });

  test("GET /users/:id returns user details", async () => {
    const { app, issueToken } = buildApp(["users:read"]);
    const token = await issueToken();

    const response = await app.request(`/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{ id: string }>(response);
    expect(body.id).toBe(userId);
  });

  test("GET /users/:id/roles returns roles assigned to user", async () => {
    const { app, issueToken } = buildApp(["users:read"]);
    const token = await issueToken();

    const response = await app.request(`/users/${userId}/roles`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<Array<{ id: string }>>(response);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]?.id).toBe(roleId);
  });

  test("PATCH /users/:id updates user", async () => {
    const { app, issueToken } = buildApp(["users:update"]);
    const token = await issueToken();

    const response = await app.request(`/users/${userId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Updated" }),
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{ name: string }>(response);
    expect(body.name).toBe("Updated");
  });

  test("PATCH /users/:id returns 403 when target is Super Admin and caller is not", async () => {
    const { app, issueTokenForEditor } = buildAppWithEditorUser();
    const token = await issueTokenForEditor();

    const response = await app.request(`/users/${userId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Updated" }),
    });

    expect(response.status).toBe(403);
    const body = await parseJson<{ error: { code: string; message: string } }>(
      response,
    );
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toContain("Super Admin");
  });

  test("DELETE /users/:id removes user", async () => {
    const { app, issueToken } = buildApp(["users:delete"]);
    const token = await issueToken();

    const response = await app.request(`/users/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(204);
  });

  test("DELETE /users/:id returns 403 when target is Super Admin and caller is not", async () => {
    const { app, issueTokenForEditor } = buildAppWithEditorUser();
    const token = await issueTokenForEditor();

    const response = await app.request(`/users/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
    const body = await parseJson<{ error: { code: string; message: string } }>(
      response,
    );
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toContain("Super Admin");
  });

  test("PUT /users/:id/roles returns 403 when assigning Super Admin", async () => {
    const { app, issueToken } = buildApp(["users:update"]);
    const token = await issueToken();

    const response = await app.request(`/users/${userId}/roles`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roleIds: [roleId] }),
    });

    expect(response.status).toBe(403);
    const body = await parseJson<{ error: { code: string; message: string } }>(
      response,
    );
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toContain("Super Admin");
  });

  test("PUT /users/:id/roles assigns non-system roles", async () => {
    const { app, issueToken } = buildApp(["users:update", "roles:create"]);
    const token = await issueToken();

    const createRoleRes = await app.request("/roles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Editor",
        description: "Can edit",
      }),
    });
    expect(createRoleRes.status).toBe(201);
    const createdRole = await parseJson<{ id: string }>(createRoleRes);
    const editorRoleId = createdRole.id;

    const response = await app.request(`/users/${userIdNoRoles}/roles`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roleIds: [editorRoleId] }),
    });

    expect(response.status).toBe(200);
    const body = await parseJson<Array<{ id: string }>>(response);
    expect(body.length).toBe(1);
    expect(body[0]?.id).toBe(editorRoleId);
  });

  test("GET /roles returns 401 without token", async () => {
    const { app } = buildApp();

    const response = await app.request("/roles");

    expect(response.status).toBe(401);
  });

  test("POST /roles returns 403 without permission", async () => {
    const { app, issueToken } = buildApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request("/roles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Nope" }),
    });

    expect(response.status).toBe(403);
  });
});
