import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type ContentStorage } from "#/application/ports/content";
import {
  type PolicyHistoryRepository,
  type RoleDeletionRequestRepository,
} from "#/application/ports/rbac";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createRbacRouter } from "#/interfaces/http/routes/rbac.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const roleId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
/** Second user (no roles) for tests that assign non-system roles. */
const userIdNoRoles = "33333333-3333-4333-8333-333333333333";
/** Editor role (non-system) for tests where caller has users:update but is not Root. */
const editorRoleId = "44444444-4444-4444-8444-444444444444";
const parseJson = async <T>(response: Response) => (await response.json()) as T;

/** Builds app with a second user (userIdNoRoles) who has only users:update via Editor role. Use issueTokenForEditor() to get a token for that user. */
function buildAppWithEditorUser(): {
  app: Hono;
  issueToken: () => Promise<string>;
  issueTokenForEditor: () => Promise<string>;
  store: ReturnType<typeof makeStore>["store"];
} {
  const { store, repositories } = makeStore();
  store.roles.push({
    id: editorRoleId,
    name: "Editor",
    description: "Can edit",
    isSystem: false,
  });
  const editorPermissions = [
    { id: "perm-users-update", resource: "users", action: "update" },
    { id: "perm-users-delete", resource: "users", action: "delete" },
    { id: "perm-roles-delete", resource: "roles", action: "delete" },
    { id: "perm-roles-read", resource: "roles", action: "read" },
  ] as const;
  store.permissions.push(...editorPermissions);
  store.rolePermissions.push(
    ...editorPermissions.map((permission) => ({
      roleId: editorRoleId,
      permissionId: permission.id,
    })),
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
    store,
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
      isRoot?: boolean;
    }>,
    userRoles: [] as Array<{ userId: string; roleId: string }>,
    rolePermissions: [] as Array<{ roleId: string; permissionId: string }>,
    roleDeletionRequests: [] as Array<{
      id: string;
      roleId: string;
      requestedByUserId: string;
      requestedAt: string;
      status: "pending" | "approved" | "rejected" | "cancelled";
      approvedByUserId: string | null;
      approvedAt: string | null;
      reason: string | null;
    }>,
    policyHistory: [] as Array<{
      id: string;
      occurredAt: string;
      policyVersion: number;
      changeType: "role_permissions" | "user_roles";
      targetId: string;
      targetType: "role" | "user";
      actorId: string | null;
      actorName: string | null;
      actorEmail: string | null;
      requestId: string | null;
      targetCount: number;
      addedCount: number;
      removedCount: number;
    }>,
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
    name: "Root",
    description: "All access",
    isSystem: true,
  });
  store.permissions.push(
    { id: "perm-root", resource: "root", action: "access", isRoot: true },
    { id: "perm-2", resource: "roles", action: "read" },
    { id: "perm-3", resource: "roles", action: "create" },
    { id: "perm-4", resource: "users", action: "read" },
  );
  store.userRoles.push({ userId, roleId });
  store.rolePermissions.push({ roleId, permissionId: "perm-root" });

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
    policyHistoryRepository: {
      create: async (
        input: Parameters<PolicyHistoryRepository["create"]>[0],
      ) => {
        const actor = store.users.find((user) => user.id === input.actorId);
        store.policyHistory.push({
          id: crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
          policyVersion: input.policyVersion,
          changeType: input.changeType,
          targetId: input.targetId,
          targetType: input.targetType,
          actorId: input.actorId ?? null,
          actorName: actor?.name ?? null,
          actorEmail: actor?.email ?? null,
          requestId: input.requestId ?? null,
          targetCount: input.targetCount,
          addedCount: input.addedCount,
          removedCount: input.removedCount,
        });
      },
      list: async ({
        offset,
        limit,
        policyVersion,
        changeType,
        targetId,
        actorId,
      }: Parameters<PolicyHistoryRepository["list"]>[0]) =>
        store.policyHistory
          .filter((item) =>
            policyVersion !== undefined
              ? item.policyVersion === policyVersion
              : true,
          )
          .filter((item) =>
            changeType ? item.changeType === changeType : true,
          )
          .filter((item) => (targetId ? item.targetId === targetId : true))
          .filter((item) => (actorId ? item.actorId === actorId : true))
          .slice(offset, offset + limit),
      count: async ({
        policyVersion,
        changeType,
        targetId,
        actorId,
      }: Parameters<PolicyHistoryRepository["count"]>[0]) =>
        store.policyHistory
          .filter((item) =>
            policyVersion !== undefined
              ? item.policyVersion === policyVersion
              : true,
          )
          .filter((item) =>
            changeType ? item.changeType === changeType : true,
          )
          .filter((item) => (targetId ? item.targetId === targetId : true))
          .filter((item) => (actorId ? item.actorId === actorId : true)).length,
    },
    roleDeletionRequestRepository: {
      createPending: async ({
        roleId,
        requestedByUserId,
        reason,
      }: Parameters<RoleDeletionRequestRepository["createPending"]>[0]) => {
        store.roleDeletionRequests.push({
          id: crypto.randomUUID(),
          roleId,
          requestedByUserId,
          requestedAt: new Date().toISOString(),
          status: "pending",
          approvedByUserId: null,
          approvedAt: null,
          reason: reason ?? null,
        });
      },
      findPendingByRoleId: async (
        roleId: Parameters<
          RoleDeletionRequestRepository["findPendingByRoleId"]
        >[0],
      ) => {
        const req = store.roleDeletionRequests.find(
          (item) => item.roleId === roleId && item.status === "pending",
        );
        if (!req) return null;
        const role = store.roles.find((item) => item.id === req.roleId);
        const requester = store.users.find(
          (item) => item.id === req.requestedByUserId,
        );
        const approver = store.users.find(
          (item) => item.id === req.approvedByUserId,
        );
        if (!role || !requester) return null;
        return {
          id: req.id,
          roleId: req.roleId,
          roleName: role.name,
          requestedByUserId: req.requestedByUserId,
          requestedByName: requester.name,
          requestedByEmail: requester.email,
          requestedAt: req.requestedAt,
          status: req.status,
          approvedByUserId: req.approvedByUserId,
          approvedByName: approver?.name ?? null,
          approvedByEmail: approver?.email ?? null,
          approvedAt: req.approvedAt,
          reason: req.reason,
        };
      },
      findById: async (
        id: Parameters<RoleDeletionRequestRepository["findById"]>[0],
      ) => {
        const req = store.roleDeletionRequests.find((item) => item.id === id);
        if (!req) return null;
        const role = store.roles.find((item) => item.id === req.roleId);
        const requester = store.users.find(
          (item) => item.id === req.requestedByUserId,
        );
        const approver = store.users.find(
          (item) => item.id === req.approvedByUserId,
        );
        if (!role || !requester) return null;
        return {
          id: req.id,
          roleId: req.roleId,
          roleName: role.name,
          requestedByUserId: req.requestedByUserId,
          requestedByName: requester.name,
          requestedByEmail: requester.email,
          requestedAt: req.requestedAt,
          status: req.status,
          approvedByUserId: req.approvedByUserId,
          approvedByName: approver?.name ?? null,
          approvedByEmail: approver?.email ?? null,
          approvedAt: req.approvedAt,
          reason: req.reason,
        };
      },
      list: async ({
        offset,
        limit,
        status,
        roleId,
      }: Parameters<RoleDeletionRequestRepository["list"]>[0]) =>
        store.roleDeletionRequests
          .filter((item) => (status ? item.status === status : true))
          .filter((item) => (roleId ? item.roleId === roleId : true))
          .slice(offset, offset + limit)
          .map((req) => {
            const role = store.roles.find((item) => item.id === req.roleId);
            const requester = store.users.find(
              (item) => item.id === req.requestedByUserId,
            );
            const approver = store.users.find(
              (item) => item.id === req.approvedByUserId,
            );
            return {
              id: req.id,
              roleId: req.roleId,
              roleName: role?.name ?? "Unknown",
              requestedByUserId: req.requestedByUserId,
              requestedByName: requester?.name ?? "Unknown",
              requestedByEmail: requester?.email ?? "unknown@example.com",
              requestedAt: req.requestedAt,
              status: req.status,
              approvedByUserId: req.approvedByUserId,
              approvedByName: approver?.name ?? null,
              approvedByEmail: approver?.email ?? null,
              approvedAt: req.approvedAt,
              reason: req.reason,
            };
          }),
      count: async ({
        status,
        roleId,
      }: Parameters<RoleDeletionRequestRepository["count"]>[0]) =>
        store.roleDeletionRequests
          .filter((item) => (status ? item.status === status : true))
          .filter((item) => (roleId ? item.roleId === roleId : true)).length,
      markApproved: async ({
        id,
        approvedByUserId,
      }: Parameters<RoleDeletionRequestRepository["markApproved"]>[0]) => {
        const req = store.roleDeletionRequests.find(
          (item) => item.id === id && item.status === "pending",
        );
        if (!req) return false;
        req.status = "approved";
        req.approvedByUserId = approvedByUserId;
        req.approvedAt = new Date().toISOString();
        return true;
      },
      markRejected: async ({
        id,
        approvedByUserId,
        reason,
      }: Parameters<RoleDeletionRequestRepository["markRejected"]>[0]) => {
        const req = store.roleDeletionRequests.find(
          (item) => item.id === id && item.status === "pending",
        );
        if (!req) return false;
        req.status = "rejected";
        req.approvedByUserId = approvedByUserId;
        req.approvedAt = new Date().toISOString();
        req.reason = reason ?? null;
        return true;
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
          .filter(
            (permission) =>
              permissionIds.includes(permission.id) &&
              permission.isRoot !== true,
          )
          .map((permission) =>
            Permission.parse(`${permission.resource}:${permission.action}`),
          );
      },
      isRootUser: async (userId: string) => {
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

  return { store, repositories };
};

const buildApp = (permissions?: string[]) => {
  const { store, repositories } = makeStore();

  if (permissions !== undefined) {
    store.permissions = permissions.map((permission, index) => {
      const [resource, action] = permission.split(":");
      if (!resource || !action) {
        throw new Error(`Invalid permission: ${permission}`);
      }
      return {
        id: `perm-${index + 1}`,
        resource,
        action,
        isRoot: false,
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

  return { app, issueToken, store };
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
    expect(body.items[0]?.name).toBe("Root");
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

    expect(response.status).toBe(422);
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
    const { app, issueToken } = buildApp();
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

  test("DELETE /roles/:id returns 403 for non-root", async () => {
    const { app, issueToken, issueTokenForEditor } = buildAppWithEditorUser();
    const superToken = await issueToken();

    const createRes = await app.request("/roles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${superToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Non-Sys Role" }),
    });
    const created = await parseJson<{ id: string }>(createRes);

    const editorToken = await issueTokenForEditor();
    const response = await app.request(`/roles/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${editorToken}` },
    });

    expect(response.status).toBe(403);
  });

  test("role deletion requests require root approval", async () => {
    const { app, issueToken, issueTokenForEditor, store } =
      buildAppWithEditorUser();
    const superToken = await issueToken();

    const createRes = await app.request("/roles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${superToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Approval Target" }),
    });
    const createdRole = await parseJson<{ id: string }>(createRes);

    const editorToken = await issueTokenForEditor();
    const requestRes = await app.request(
      `/roles/${createdRole.id}/deletion-requests`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${editorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "no longer used" }),
      },
    );
    expect(requestRes.status).toBe(204);
    expect(store.roleDeletionRequests).toHaveLength(1);

    const requestId = store.roleDeletionRequests[0]?.id;
    expect(requestId).toBeDefined();

    const editorApprove = await app.request(
      `/roles/deletion-requests/${requestId}/approve`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${editorToken}` },
      },
    );
    expect(editorApprove.status).toBe(403);

    const superApprove = await app.request(
      `/roles/deletion-requests/${requestId}/approve`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${superToken}` },
      },
    );
    expect(superApprove.status).toBe(204);
  });

  test("GET /roles/deletion-requests lists requests", async () => {
    const { app, issueToken, issueTokenForEditor } = buildAppWithEditorUser();
    const superToken = await issueToken();
    const editorToken = await issueTokenForEditor();

    const createRes = await app.request("/roles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${superToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "List Target" }),
    });
    const createdRole = await parseJson<{ id: string }>(createRes);

    const requestRes = await app.request(
      `/roles/${createdRole.id}/deletion-requests`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${editorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "cleanup" }),
      },
    );
    expect(requestRes.status).toBe(204);

    const listRes = await app.request("/roles/deletion-requests", {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    expect(listRes.status).toBe(200);
    const body = await parseJson<{
      items: Array<{ roleId: string }>;
      total: number;
    }>(listRes);
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.some((item) => item.roleId === createdRole.id)).toBe(
      true,
    );
  });

  test("GET /roles/deletion-requests returns 403 without roles:delete", async () => {
    const { app, issueToken } = buildApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request("/roles/deletion-requests", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
  });

  test("GET /roles/:id/permissions returns permissions", async () => {
    const { app, issueToken } = buildApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request(`/roles/${roleId}/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      items: Array<{ id: string }>;
      total: number;
      page: number;
      pageSize: number;
    }>(response);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);
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

  test("PUT /roles/:id/permissions writes policy history only when policyVersion is provided", async () => {
    const { app, issueToken, store } = buildApp([
      "roles:update",
      "roles:create",
    ]);
    const token = await issueToken();

    const createRes = await app.request("/roles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "History Role" }),
    });
    const created = await parseJson<{ id: string }>(createRes);

    const firstUpdate = await app.request(`/roles/${created.id}/permissions`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ permissionIds: ["perm-2"] }),
    });
    expect(firstUpdate.status).toBe(200);
    expect(store.policyHistory).toHaveLength(0);

    const secondUpdate = await app.request(`/roles/${created.id}/permissions`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        permissionIds: ["perm-2", "perm-3"],
        policyVersion: 12,
      }),
    });
    expect(secondUpdate.status).toBe(200);
    expect(store.policyHistory).toHaveLength(1);
    expect(store.policyHistory[0]?.policyVersion).toBe(12);
    expect(store.policyHistory[0]?.changeType).toBe("role_permissions");
  });

  test("GET /roles/:id/users returns users assigned to role", async () => {
    const { app, issueToken } = buildApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request(`/roles/${roleId}/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      items: Array<{ id: string }>;
      total: number;
      page: number;
      pageSize: number;
    }>(response);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.id).toBe(userId);
    expect(body.total).toBeGreaterThan(0);
  });

  test("GET /roles/:id/users returns avatarUrl and omits avatarKey when avatarStorage is provided", async () => {
    const { app, issueToken, presignedUrl } = buildAppWithAvatarStorage();
    const token = await issueToken();

    const response = await app.request(`/roles/${roleId}/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      items: Array<{
        id: string;
        avatarUrl?: string;
        avatarKey?: string;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>(response);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.avatarUrl).toBe(presignedUrl);
    expect(body.items[0]).not.toHaveProperty("avatarKey");
    expect(body.total).toBeGreaterThan(0);
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
    const body = await parseJson<{
      items: Array<{ id: string }>;
      total: number;
      page: number;
      pageSize: number;
    }>(response);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.id).toBe(roleId);
    expect(body.total).toBeGreaterThan(0);
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

  test("PATCH /users/:id returns 403 when target is Root and caller is not", async () => {
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
    expect(body.error.message).toContain("Root");
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

  test("DELETE /users/:id returns 403 when target is Root and caller is not", async () => {
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
    expect(body.error.message).toContain("Root");
  });

  test("PUT /users/:id/roles returns 403 when assigning Root", async () => {
    const { app, issueToken } = buildApp();
    const token = await issueToken();

    const response = await app.request(`/users/${userIdNoRoles}/roles`, {
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
    expect(body.error.message).toContain("Root");
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

  test("GET /policy-history returns versioned policy changes", async () => {
    const { app, issueToken, store } = buildApp([
      "roles:read",
      "roles:update",
      "roles:create",
      "users:update",
    ]);
    const token = await issueToken();

    const createRoleRes = await app.request("/roles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Audited Role" }),
    });
    const createdRole = await parseJson<{ id: string }>(createRoleRes);

    const setRolePerms = await app.request(
      `/roles/${createdRole.id}/permissions`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ permissionIds: ["perm-2"], policyVersion: 3 }),
      },
    );
    expect(setRolePerms.status).toBe(200);

    const setUserRoles = await app.request(`/users/${userIdNoRoles}/roles`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roleIds: [createdRole.id], policyVersion: 3 }),
    });
    expect(setUserRoles.status).toBe(200);
    expect(store.policyHistory.length).toBe(2);

    const response = await app.request("/policy-history?policyVersion=3", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      items: Array<{ changeType: string; policyVersion: number }>;
      total: number;
    }>(response);
    expect(body.total).toBe(2);
    expect(body.items.every((item) => item.policyVersion === 3)).toBe(true);
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
