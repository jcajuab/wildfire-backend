import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type PermissionRecord } from "#/application/ports/rbac";
import {
  ChangeCurrentUserPasswordUseCase,
  SetCurrentUserAvatarUseCase,
  UpdateCurrentUserProfileUseCase,
} from "#/application/use-cases/auth";
import { DeleteCurrentUserUseCase } from "#/application/use-cases/rbac";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { logger } from "#/infrastructure/observability/logger";
import {
  requestId,
  requestLogger,
} from "#/interfaces/http/middleware/observability";
import { createAuthRouter } from "#/interfaces/http/routes/auth.route";
import { createContentRouter } from "#/interfaces/http/routes/content.route";
import { createRbacRouter } from "#/interfaces/http/routes/rbac.route";
import { InMemoryAuthSecurityStore } from "#/interfaces/http/security/in-memory-auth-security.store";

const parseJson = async <T>(response: Response) => (await response.json()) as T;

const withCapturedLogs = async (
  run: () => Promise<void>,
): Promise<Array<Record<string, unknown>>> => {
  const logs: Array<Record<string, unknown>> = [];
  const originalInfo = logger.info;

  logger.info = ((obj: Record<string, unknown>, _msg?: string) => {
    logs.push(obj);
  }) as typeof logger.info;

  try {
    await run();
    return logs;
  } finally {
    logger.info = originalInfo;
  }
};

const buildAuthActionApp = () => {
  const userRecord = {
    id: "user-1",
    email: "admin@example.com",
    name: "Admin",
    isActive: true,
    timezone: null,
    avatarKey: null,
  };
  const credentialsRepository = {
    findPasswordHash: async (email: string) =>
      email === userRecord.email ? "hash" : null,
    updatePasswordHash: async () => {},
  };
  const passwordVerifier = {
    verify: async (input: { password: string; passwordHash: string }) =>
      input.password === "password" && input.passwordHash === "hash",
  };
  const passwordHasher = {
    hash: async (password: string) => `hashed-${password}`,
  };
  const avatarStorage = {
    upload: async () => {},
    delete: async () => {},
    getPresignedDownloadUrl: async () => "https://example.com/avatar",
  };
  const userRepository = {
    list: async () => [userRecord],
    findById: async (id: string) => (id === userRecord.id ? userRecord : null),
    findByIds: async (ids: string[]) =>
      ids.includes(userRecord.id) ? [userRecord] : [],
    findByEmail: async (email: string) =>
      email === userRecord.email ? userRecord : null,
    create: async () => userRecord,
    update: async () => userRecord,
    delete: async () => true,
  };
  const authSessionRepository: AuthSessionRepository = {
    create: async () => {},
    revokeById: async () => {},
    revokeAllForUser: async () => {},
    isActive: async () => true,
  };

  const authRouter = createAuthRouter({
    credentialsRepository,
    passwordVerifier,
    passwordHasher,
    tokenIssuer: {
      issueToken: async () => "token-value",
    },
    userRepository,
    authorizationRepository: {
      findPermissionsForUser: async () => [new Permission("roles", "read")],
    },
    clock: {
      nowSeconds: () => Math.floor(Date.now() / 1000),
    },
    tokenTtlSeconds: 3600,
    issuer: "wildfire",
    jwtSecret: "test-secret",
    authSessionRepository,
    authSessionCookieName: "wildfire_session_token",
    authSessionDualMode: true,
    authSecurityStore: new InMemoryAuthSecurityStore(),
    authLoginRateLimitMaxAttempts: 20,
    authLoginRateLimitWindowSeconds: 60,
    authLoginLockoutThreshold: 10,
    authLoginLockoutSeconds: 60,
    deleteCurrentUserUseCase: new DeleteCurrentUserUseCase({ userRepository }),
    updateCurrentUserProfileUseCase: new UpdateCurrentUserProfileUseCase({
      userRepository,
    }),
    changeCurrentUserPasswordUseCase: new ChangeCurrentUserPasswordUseCase({
      userRepository,
      credentialsRepository,
      passwordVerifier,
      passwordHasher,
    }),
    setCurrentUserAvatarUseCase: new SetCurrentUserAvatarUseCase({
      userRepository,
      storage: avatarStorage,
    }),
    avatarStorage,
    avatarUrlExpiresInSeconds: 3600,
  });

  const app = new Hono();
  app.use("*", requestId());
  app.use("*", requestLogger);
  app.route("/auth", authRouter);

  return app;
};

const buildContentActionApp = async () => {
  const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
  const nowSeconds = Math.floor(Date.now() / 1000);

  const router = createContentRouter({
    jwtSecret: "test-secret",
    maxUploadBytes: 5 * 1024 * 1024,
    downloadUrlExpiresInSeconds: 3600,
    repositories: {
      contentRepository: {
        create: async (input) => ({
          ...input,
          createdAt: new Date().toISOString(),
        }),
        findById: async () => null,
        findByIds: async () => [],
        list: async () => ({ items: [], total: 0 }),
        delete: async () => false,
        update: async () => null,
      },
      userRepository: {
        list: async () => [],
        findById: async () => null,
        findByIds: async () => [],
        findByEmail: async () => null,
        create: async () => {
          throw new Error("not implemented");
        },
        update: async () => null,
        delete: async () => false,
      },
      authorizationRepository: {
        findPermissionsForUser: async () => [new Permission("content", "read")],
      },
    },
    storage: {
      upload: async () => {},
      delete: async () => {},
      getPresignedDownloadUrl: async () => "https://example.com/file",
    },
  });

  const app = new Hono();
  app.use("*", requestId());
  app.use("*", requestLogger);
  app.route("/content", router);

  const token = await tokenIssuer.issueToken({
    subject: "user-1",
    email: "user@example.com",
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + 3600,
    issuer: "wildfire",
  });

  return { app, token };
};

const buildRbacActionApp = async () => {
  const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
  const nowSeconds = Math.floor(Date.now() / 1000);

  const permissionRecords: PermissionRecord[] = [
    {
      id: "perm-users-read",
      resource: "users",
      action: "read",
    },
  ];

  const router = createRbacRouter({
    jwtSecret: "test-secret",
    repositories: {
      userRepository: {
        list: async () => [],
        findById: async () => null,
        findByIds: async () => [],
        findByEmail: async () => null,
        create: async () => ({
          id: "user-1",
          email: "user@example.com",
          name: "User",
          isActive: true,
        }),
        update: async () => null,
        delete: async () => false,
      },
      roleRepository: {
        list: async () => [],
        findById: async () => null,
        findByIds: async () => [],
        create: async () => ({
          id: "role-1",
          name: "Role",
          description: null,
          isSystem: false,
        }),
        update: async () => null,
        delete: async () => false,
      },
      permissionRepository: {
        list: async () => permissionRecords,
        findByIds: async (ids: string[]) =>
          permissionRecords.filter((permission) => ids.includes(permission.id)),
        create: async ({ resource, action }) => ({
          id: "perm-new",
          resource,
          action,
        }),
      },
      userRoleRepository: {
        listRolesByUserId: async () => [],
        listUserIdsByRoleId: async () => [],
        listUserCountByRoleIds: async () => ({}),
        setUserRoles: async () => {},
      },
      rolePermissionRepository: {
        listPermissionsByRoleId: async () => [],
        setRolePermissions: async () => {},
      },
      authorizationRepository: {
        findPermissionsForUser: async () => [new Permission("users", "read")],
      },
    },
  });

  const app = new Hono();
  app.use("*", requestId());
  app.use("*", requestLogger);
  app.route("/", router);

  const token = await tokenIssuer.issueToken({
    subject: "user-1",
    email: "user@example.com",
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + 3600,
    issuer: "wildfire",
  });

  return { app, token };
};

describe("Route action metadata", () => {
  test("auth login emits action metadata", async () => {
    const app = buildAuthActionApp();

    const logs = await withCapturedLogs(async () => {
      const response = await app.request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "password",
        }),
      });

      expect(response.status).toBe(200);
      const body = await parseJson<{ user: { id: string } }>(response);
      expect(body.user.id).toBe("user-1");
    });

    const entry = logs.find((log) => log.action === "auth.session.login");
    expect(entry).toBeDefined();
    expect(entry?.route).toBe("/auth/login");
  });

  test("content list emits action metadata", async () => {
    const { app, token } = await buildContentActionApp();

    const logs = await withCapturedLogs(async () => {
      const response = await app.request("/content", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
    });

    const entry = logs.find((log) => log.action === "content.content.list");
    expect(entry).toBeDefined();
    expect(entry?.route).toBe("/content");
  });

  test("rbac users list emits action metadata", async () => {
    const { app, token } = await buildRbacActionApp();

    const logs = await withCapturedLogs(async () => {
      const response = await app.request("/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
    });

    const entry = logs.find((log) => log.action === "rbac.user.list");
    expect(entry).toBeDefined();
    expect(entry?.route).toBe("/users");
  });
});
