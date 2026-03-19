import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type PermissionRecord } from "#/application/ports/rbac";
import {
  createAuthHttpModule,
  createContentHttpModule,
  createRbacHttpModule,
} from "#/bootstrap/http/modules";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { logger } from "#/infrastructure/observability/logger";
import {
  requestId,
  requestLogger,
} from "#/interfaces/http/middleware/observability";
import { createAuthRouter } from "#/interfaces/http/routes/auth";
import { createContentRouter } from "#/interfaces/http/routes/content";
import { createRbacRouter } from "#/interfaces/http/routes/rbac";
import { InMemoryAuthSecurityStore } from "../../helpers/in-memory-auth-security.store";

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
    username: "admin",
    email: "admin@example.com",
    name: "Admin",
    isActive: true,
    timezone: null,
    avatarKey: null,
  };
  const credentialsRepository = {
    findPasswordHash: async (username: string) =>
      username === userRecord.username ? "hash" : null,
    updatePasswordHash: async () => {},
    createPasswordHash: async () => {},
  };
  const passwordVerifier = {
    verify: async (input: { password: string; passwordHash: string }) =>
      input.password === "password" && input.passwordHash === "hash",
  };
  const passwordHasher = {
    hash: async (password: string) => `hashed-${password}`,
  };
  const avatarStorage = {
    ensureBucketExists: async () => {},
    upload: async () => {},
    delete: async () => {},
    getPresignedDownloadUrl: async () => "https://example.com/avatar",
  };
  const userRepository = {
    list: async () => [userRecord],
    findById: async (id: string) => (id === userRecord.id ? userRecord : null),
    findByIds: async (ids: string[]) =>
      ids.includes(userRecord.id) ? [userRecord] : [],
    findByUsername: async (username: string) =>
      username === userRecord.username ? userRecord : null,
    findByEmail: async (email: string) =>
      email === userRecord.email ? userRecord : null,
    create: async () => userRecord,
    update: async () => userRecord,
    delete: async () => true,
  };
  const authSessionRepository: AuthSessionRepository = {
    create: async () => {},
    extendExpiry: async () => {},
    revokeById: async () => {},
    revokeAllForUser: async () => {},
    isActive: async () => true,
    isOwnedByUser: async () => true,
  };

  const authRouter = createAuthRouter(
    createAuthHttpModule({
      credentialsRepository,
      dbCredentialsRepository: {
        findPasswordHash: async () => null,
        updatePasswordHash: async () => {},
        createPasswordHash: async () => {},
      },
      passwordVerifier,
      passwordHasher,
      tokenIssuer: {
        issueToken: async () => "token-value",
      },
      userRepository,
      authorizationRepository: {
        findPermissionsForUser: async () => [new Permission("roles", "read")],
        isAdminUser: async () => false,
      },
      clock: {
        nowSeconds: () => Math.floor(Date.now() / 1000),
      },
      tokenTtlSeconds: 3600,
      issuer: "wildfire",
      jwtSecret: "test-secret",
      authSessionRepository,
      authSessionCookieName: "wildfire_session_token",
      authSecurityStore: new InMemoryAuthSecurityStore(),
      authLoginRateLimitMaxAttempts: 20,
      authLoginRateLimitWindowSeconds: 60,
      authLoginLockoutThreshold: 10,
      authLoginLockoutSeconds: 60,
      trustProxyHeaders: true,
      invitationRepository: {
        create: async () => {},
        findActiveByHashedToken: async () => null,
        findById: async () => null,
        findEncryptedTokenById: async () => null,
        countAll: async () => 0,
        listPage: async () => [],
        revokeActiveByEmail: async () => {},
        markAccepted: async () => {},
        deleteExpired: async () => {},
      },
      includeDevelopmentInviteUrls: true,
      inviteTokenTtlSeconds: 3600,
      inviteAcceptBaseUrl: "http://localhost:3000/accept-invite",
      inviteEncryptionKey: "0".repeat(64),
      avatarStorage,
      avatarUrlExpiresInSeconds: 3600,
    }),
  );

  const app = new Hono();
  app.use("*", requestId());
  app.use("*", requestLogger);
  app.route("/auth", authRouter);

  return app;
};

const buildContentActionApp = async () => {
  const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
  const nowSeconds = Math.floor(Date.now() / 1000);

  const router = createContentRouter(
    createContentHttpModule({
      jwtSecret: "test-secret",
      authSessionRepository: {
        create: async () => {},
        extendExpiry: async () => {},
        revokeById: async () => {},
        revokeAllForUser: async () => {},
        isActive: async () => true,
        isOwnedByUser: async () => true,
      },
      authSessionCookieName: "wildfire_session_token",
      maxUploadBytes: 5 * 1024 * 1024,
      videoMaxUploadBytes: 50 * 1024 * 1024,
      downloadUrlExpiresInSeconds: 3600,
      thumbnailUrlExpiresInSeconds: 3600,
      repositories: {
        contentRepository: {
          create: async (input) => ({
            ...input,
            createdAt: new Date().toISOString(),
          }),
          findById: async () => null,
          findByIdForOwner: async () => null,
          findByIds: async () => [],
          findByIdsForOwner: async () => [],
          list: async () => ({ items: [], total: 0 }),
          listForOwner: async () => ({ items: [], total: 0 }),
          delete: async () => false,
          deleteForOwner: async () => false,
          update: async () => null,
          updateForOwner: async () => null,
        },
        contentIngestionJobRepository: {
          create: async (input: {
            id: string;
            contentId: string;
            operation: "UPLOAD" | "REPLACE";
            status: "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
            ownerId: string;
            errorMessage?: string | null;
          }) => ({
            id: input.id,
            contentId: input.contentId,
            operation: input.operation,
            status: input.status,
            errorMessage: input.errorMessage ?? null,
            ownerId: input.ownerId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
          }),
          findById: async () => null,
          update: async () => null,
        },
        scheduleRepository: {
          list: async () => [],
          listByDisplay: async () => [],
          listByPlaylistId: async () => [],
          listByContentId: async () => [],
          findById: async () => null,
          create: async () => {
            throw new Error("not implemented");
          },
          update: async () => null,
          delete: async () => false,
          countByPlaylistId: async () => 0,
          countByContentId: async () => 0,
        },
        userRepository: {
          list: async () => [],
          findById: async () => null,
          findByIds: async () => [],
          findByUsername: async () => null,
          findByEmail: async () => null,
          create: async () => {
            throw new Error("not implemented");
          },
          update: async () => null,
          delete: async () => false,
        },
        authorizationRepository: {
          findPermissionsForUser: async () => [
            new Permission("content", "read"),
          ],
          isAdminUser: async () => false,
        },
      },
      storage: {
        ensureBucketExists: async () => {},
        upload: async () => {},
        download: async () => new Uint8Array(),
        delete: async () => {},
        getPresignedDownloadUrl: async () => "https://example.com/file",
      },
      contentIngestionQueue: {
        enqueue: async () => {},
      },
      contentMetadataExtractor: {
        extract: async () => ({ width: 1366, height: 768, duration: null }),
      },
      contentThumbnailGenerator: {
        generate: async () => null,
      },
      contentJobEventPublisher: {
        publish: () => {},
      },
      contentJobEventSubscription: {
        subscribe: () => () => {},
      },
      displayEventPublisher: {
        publish: () => {},
      },
      pdfCropSessionStore: {
        save: async () => {},
        findById: async () => null,
        delete: async () => {},
      },
      pdfPageExtractor: {
        extract: async () => ({ pageCount: 1, pages: [] }),
      },
      pdfCropRenderer: {
        renderCrop: async () => new Uint8Array(),
      },
    }),
  );

  const app = new Hono();
  app.use("*", requestId());
  app.use("*", requestLogger);
  app.route("/content", router);

  const token = await tokenIssuer.issueToken({
    subject: "user-1",
    username: "user",
    email: "user@example.com",
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + 3600,
    sessionId: crypto.randomUUID(),
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

  const router = createRbacRouter(
    createRbacHttpModule({
      jwtSecret: "test-secret",
      authSessionRepository: {
        create: async () => {},
        extendExpiry: async () => {},
        revokeById: async () => {},
        revokeAllForUser: async () => {},
        isActive: async () => true,
        isOwnedByUser: async () => true,
      },
      authSessionCookieName: "wildfire_session_token",
      credentialsRepository: {
        findPasswordHash: async () => null,
      },
      dbCredentialsRepository: {
        findPasswordHash: async () => null,
        updatePasswordHash: async () => {},
        createPasswordHash: async () => {},
      },
      passwordHasher: {
        hash: async (p: string) => p,
      },
      repositories: {
        userRepository: {
          list: async () => [],
          findById: async () => null,
          findByIds: async () => [],
          findByUsername: async () => null,
          findByEmail: async () => null,
          create: async () => ({
            id: "user-1",
            username: "user",
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
          }),
          update: async () => null,
          delete: async () => false,
        },
        permissionRepository: {
          list: async () => permissionRecords,
          findByIds: async (ids: string[]) =>
            permissionRecords.filter((permission) =>
              ids.includes(permission.id),
            ),
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
          isAdminUser: async () => false,
        },
      },
    }),
  );

  const app = new Hono();
  app.use("*", requestId());
  app.use("*", requestLogger);
  app.route("/", router);

  const token = await tokenIssuer.issueToken({
    subject: "user-1",
    username: "user",
    email: "user@example.com",
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + 3600,
    sessionId: crypto.randomUUID(),
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
          username: "admin",
          password: "password",
        }),
      });

      expect(response.status).toBe(200);
      const body = await parseJson<{ data: { user: { id: string } } }>(
        response,
      );
      expect(body.data.user.id).toBe("user-1");
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
