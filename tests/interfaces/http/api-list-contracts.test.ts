import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type ContentRecord } from "#/application/ports/content";
import { type ContentStatus, type ContentType } from "#/domain/content/content";
import { type PlaylistStatus } from "#/domain/playlists/playlist";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import {
  type ContentRouterDeps,
  createContentRouter,
} from "#/interfaces/http/routes/content.route";
import {
  createDisplaysRouter,
  type DisplaysRouterDeps,
} from "#/interfaces/http/routes/displays.route";
import {
  createRbacRouter,
  type RbacRouterDeps,
} from "#/interfaces/http/routes/rbac.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const nowSeconds = Math.floor(Date.now() / 1000);

const parseJson = async <T>(response: Response) => (await response.json()) as T;

const expectCanonicalListMeta = (meta: {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}) => {
  expect({ ...meta }).toMatchObject({
    total: expect.any(Number),
    page: expect.any(Number),
    per_page: expect.any(Number),
    total_pages: expect.any(Number),
  });
  expect(meta.total).toBeGreaterThanOrEqual(0);
  expect(Number.isInteger(meta.total)).toBe(true);
  expect(meta.page).toBeGreaterThanOrEqual(1);
  expect(Number.isInteger(meta.page)).toBe(true);
  expect(meta.per_page).toBeGreaterThan(0);
  expect(Number.isInteger(meta.per_page)).toBe(true);
  expect(meta.total_pages).toBeGreaterThanOrEqual(1);
  expect(meta.total_pages).toBe(
    Math.max(1, Math.ceil(meta.total / meta.per_page)),
  );
};

const makeIssueToken = () =>
  tokenIssuer.issueToken({
    subject: "user-1",
    email: "admin@example.com",
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + 3600,
    issuer: undefined,
  });

const makeDisplaysListApp = async (permissions: string[]) => {
  const app = new Hono();
  const displays = [
    {
      id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      name: "Lobby",
      identifier: "AA:BB",
      displaySlug: "lobby-display",
      displayFingerprint: null,
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ];

  const repositories: DisplaysRouterDeps["repositories"] = {
    displayRepository: {
      list: async () => displays,
      findByIds: async (ids: string[]) =>
        displays.filter((item) => ids.includes(item.id)),
      findById: async (id: string) =>
        displays.find((item) => item.id === id) ?? null,
      findByIdentifier: async (identifier: string) =>
        displays.find((item) => item.identifier === identifier) ?? null,
      findByFingerprint: async (fingerprint: string) =>
        displays.find((item) => item.displayFingerprint === fingerprint) ??
        null,
      create: async (_input: {
        name: string;
        identifier: string;
        displayFingerprint?: string | null;
        location: string | null;
      }) => {
        throw new Error("not needed in contract test");
      },
      update: async (
        _id: string,
        _input: {
          name?: string;
          identifier?: string;
          displayFingerprint?: string | null;
          location?: string | null;
          screenWidth?: number | null;
          screenHeight?: number | null;
          outputType?: string | null;
          orientation?: "LANDSCAPE" | "PORTRAIT" | null;
        },
      ) => null,
      bumpRefreshNonce: async (_id: string) => false,
    },
    scheduleRepository: {
      list: async () => [],
      listByDisplay: async (_displayId: string) => [],
      listByPlaylistId: async (_playlistId: string) => [],
      findById: async (_id: string) => null,
      create: async (_input: {
        name: string;
        playlistId: string;
        displayId: string;
        startDate?: string;
        endDate?: string;
        startTime: string;
        endTime: string;
        priority: number;
        isActive: boolean;
      }) => {
        throw new Error("not needed in contract test");
      },
      update: async (
        _id: string,
        _input: {
          name?: string;
          playlistId?: string;
          displayId?: string;
          startDate?: string;
          endDate?: string;
          startTime?: string;
          endTime?: string;
          priority?: number;
          isActive?: boolean;
        },
      ) => null,
      delete: async (_id: string) => false,
      countByPlaylistId: async (_playlistId: string) => 0,
    },
    playlistRepository: {
      list: async () => [],
      listPage: async (_input: {
        offset: number;
        limit: number;
        status?: PlaylistStatus;
        search?: string;
        sortBy?: "updatedAt" | "name";
        sortDirection?: "asc" | "desc";
      }) => ({ items: [], total: 0 }),
      findByIds: async (_ids: string[]) => [],
      findById: async (_id: string) => null,
      create: async (_input: { name: string; description: string | null }) => {
        throw new Error("not needed in contract test");
      },
      update: async (
        _id: string,
        _input: { name?: string; description?: string | null },
      ) => null,
      updateStatus: async (_id: string, _status: string) => {},
      delete: async (_id: string) => false,
      listItems: async (_playlistId: string) => [],
      listItemStatsByPlaylistIds: async (_playlistIds: string[]) => new Map(),
      findItemById: async (_id: string) => null,
      countItemsByContentId: async (_contentId: string) => 0,
      addItem: async (_input: {
        playlistId: string;
        contentId: string;
        sequence: number;
        duration: number;
      }) => {
        throw new Error("not needed in contract test");
      },
      updateItem: async (
        _id: string,
        _input: { sequence?: number; duration?: number },
      ) => null,
      reorderItems: async (_input: {
        playlistId: string;
        orderedItemIds: readonly string[];
      }) => false,
      deleteItem: async (_id: string) => false,
    },
    contentRepository: {
      create: async (_input: { id: string; fileKey: string }) => {
        throw new Error("not needed in contract test");
      },
      findById: async (_id: string) => null,
      findByIds: async (_ids: string[]) => [],
      list: async (_input: { offset: number; limit: number }) => ({
        items: [],
        total: 0,
      }),
      update: async (
        _id: string,
        _input: {
          title?: string;
          fileKey?: string;
          thumbnailKey?: string | null;
        },
      ) => null,
      delete: async (_id: string) => false,
      countPlaylistReferences: async (_contentId: string) => 0,
      listPlaylistsReferencingContent: async (_contentId: string) => [],
    },
    authorizationRepository: {
      findPermissionsForUser: async (_userId: string) =>
        permissions.map((permission) => Permission.parse(permission)),
    },
    displayGroupRepository: {
      list: async () => [],
      findById: async (_id: string) => null,
      findByName: async (_name: string) => null,
      create: async (_input: { name: string; colorIndex: number }) => {
        throw new Error("not needed in contract test");
      },
      update: async (
        _id: string,
        _input: { name?: string; colorIndex?: number },
      ) => null,
      delete: async (_id: string) => false,
      setDisplayGroups: async (_displayId: string, _groupIds: string[]) => {},
    },
    displayPairingCodeRepository: {
      create: async (_input: {
        codeHash: string;
        expiresAt: Date;
        createdById: string;
      }) => {
        throw new Error("not needed in contract test");
      },
      consumeValidCode: async (_input: { codeHash: string; now: Date }) => null,
    },
    displayKeyRepository: {
      create: async (_input: {
        displayId: string;
        algorithm: "ed25519";
        publicKey: string;
      }) => ({
        id: "key-1",
        displayId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        algorithm: "ed25519" as const,
        publicKey: "test-public-key",
        status: "active" as const,
        revokedAt: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }),
      findActiveByKeyId: async (_keyId: string) => null,
      findActiveByDisplayId: async (_displayId: string) => null,
      revokeByDisplayId: async (_displayId: string, _at: Date) => {},
    },
    displayStateTransitionRepository: {
      create: async (_input: {
        displayId: string;
        fromState:
          | "unpaired"
          | "pairing_in_progress"
          | "registered"
          | "active"
          | "unregistered";
        toState:
          | "unpaired"
          | "pairing_in_progress"
          | "registered"
          | "active"
          | "unregistered";
        reason: string;
        actorType: "staff" | "display" | "system";
        actorId?: string | null;
        createdAt: Date;
      }) => ({
        id: "transition-1",
        displayId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        fromState: "active" as const,
        toState: "unregistered" as const,
        reason: "contract_test",
        actorType: "system" as const,
        actorId: null,
        createdAt: "2025-01-01T00:00:00.000Z",
      }),
    },
    systemSettingRepository: {
      findByKey: async (_key: string) => null,
      upsert: async (_input: { key: string; value: string }) => ({
        key: "display_runtime_scroll_px_per_second",
        value: "12",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }),
    },
  };

  app.route(
    "/displays",
    createDisplaysRouter({
      jwtSecret: "test-secret",
      downloadUrlExpiresInSeconds: 3600,
      repositories,
      storage: {
        upload: async (_input: {
          key: string;
          body: Uint8Array;
          contentType: string;
          contentLength: number;
        }) => {},
        delete: async (_key: string) => {},
        getPresignedDownloadUrl: async ({
          key,
        }: {
          key: string;
          expiresInSeconds: number;
          responseContentDisposition?: string;
        }) => `https://example.com/${key}`,
      },
    }),
  );

  return { app, issueToken: makeIssueToken };
};

const makeContentListApp = async (permissions: string[]) => {
  const app = new Hono();
  const users = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      email: "admin@example.com",
      name: "Admin",
      isActive: true,
    },
  ];
  const contentCreatorId =
    users[0]?.id ?? "11111111-1111-4111-8111-111111111111";
  const contentRecords: ContentRecord[] = [
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Poster",
      type: "IMAGE" as ContentType,
      status: "DRAFT" as ContentStatus,
      fileKey: "content/images/22222222-2222-4222-8222-222222222222.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 10,
      width: null,
      height: null,
      duration: null,
      createdById: contentCreatorId,
      createdAt: "2025-01-01T00:00:00.000Z",
      thumbnailKey: null,
    },
  ];

  const repositories: ContentRouterDeps["repositories"] = {
    contentRepository: {
      create: async (_input: { fileKey: string }) => {
        throw new Error("not needed in contract test");
      },
      findById: async (_id: string) => null,
      findByIds: async (ids: string[]) =>
        contentRecords.filter((item) => ids.includes(item.id)),
      list: async ({
        offset,
        limit,
      }: {
        offset: number;
        limit: number;
        status?: "DRAFT" | "IN_USE";
        type?: "IMAGE" | "VIDEO" | "PDF";
        search?: string;
        sortBy?: "createdAt" | "title" | "fileSize" | "type";
        sortDirection?: "asc" | "desc";
      }) => ({
        items: contentRecords.slice(offset, offset + limit),
        total: contentRecords.length,
      }),
      countPlaylistReferences: async (_contentId: string) => 0,
      listPlaylistsReferencingContent: async (_contentId: string) => [],
      update: async (
        _id: string,
        _input: {
          title?: string;
          status?: "DRAFT" | "IN_USE";
          fileKey?: string;
          thumbnailKey?: string | null;
          type?: "IMAGE" | "VIDEO" | "PDF";
          mimeType?: string;
          fileSize?: number;
          checksum?: string;
          width?: number;
          height?: number;
          duration?: number | null;
        },
      ) => null,
      delete: async (_id: string) => false,
    },
    userRepository: {
      list: async () => users,
      findById: async (_id: string) => users[0] ?? null,
      findByIds: async (ids: string[]) =>
        users.filter((user) => ids.includes(user.id)),
      findByEmail: async (_email: string) => users[0] ?? null,
      create: async (_input: {
        email: string;
        name: string;
        isActive?: boolean;
      }) => {
        throw new Error("not needed in contract test");
      },
      update: async (
        _id: string,
        _input: {
          email?: string;
          name?: string;
          isActive?: boolean;
          avatarKey?: string | null;
          lastSeenAt?: string | null;
        },
      ) => null,
      delete: async (_id: string) => false,
    },
    authorizationRepository: {
      findPermissionsForUser: async (_userId: string) =>
        permissions.map((permission) => Permission.parse(permission)),
    },
  };

  app.route(
    "/content",
    createContentRouter({
      jwtSecret: "test-secret",
      maxUploadBytes: 5 * 1024 * 1024,
      downloadUrlExpiresInSeconds: 3600,
      thumbnailUrlExpiresInSeconds: 3600,
      repositories,
      storage: {
        upload: async (_input: {
          key: string;
          body: Uint8Array;
          contentType: string;
          contentLength: number;
        }) => {},
        delete: async (_key: string) => {},
        getPresignedDownloadUrl: async ({
          key,
        }: {
          key: string;
          expiresInSeconds: number;
          responseContentDisposition?: string;
        }) => `https://example.com/${key}`,
      },
      contentMetadataExtractor: {
        extract: async (_input: {
          type: "IMAGE" | "VIDEO" | "PDF";
          mimeType: string;
          data: Uint8Array;
        }) => ({ width: 1366, height: 768, duration: null }),
      },
      contentThumbnailGenerator: {
        generate: async (_input: {
          type: "IMAGE" | "VIDEO" | "PDF";
          mimeType: string;
          data: Uint8Array;
        }) => null,
      },
    }),
  );

  return { app, issueToken: makeIssueToken };
};

const makeRbacListApp = async (permissions: string[]) => {
  const app = new Hono();
  const users = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      email: "admin@example.com",
      name: "Admin",
      isActive: true,
    },
  ];
  const roles = [
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Root",
      description: "All access",
      isSystem: true,
    },
  ];

  const repositories: RbacRouterDeps["repositories"] = {
    userRepository: {
      list: async () => users,
      findById: async (_id: string) => users[0] ?? null,
      findByIds: async (ids: string[]) =>
        users.filter((user) => ids.includes(user.id)),
      findByEmail: async (_email: string) => users[0] ?? null,
      create: async (_input: {
        email: string;
        name: string;
        isActive?: boolean;
      }) => {
        throw new Error("not needed in contract test");
      },
      update: async (
        _id: string,
        _input: {
          email?: string;
          name?: string;
          isActive?: boolean;
          avatarKey?: string | null;
        },
      ) => null,
      delete: async (_id: string) => false,
    },
    roleRepository: {
      list: async () => roles,
      findById: async (_id: string) => roles[0] ?? null,
      findByIds: async (ids: string[]) =>
        roles.filter((role) => ids.includes(role.id)),
      create: async (_input: {
        name: string;
        description?: string | null;
        isSystem?: boolean;
      }) => {
        throw new Error("not needed in contract test");
      },
      update: async (
        _id: string,
        _input: {
          name?: string;
          description?: string | null;
        },
      ) => null,
      delete: async (_id: string) => false,
    },
    permissionRepository: {
      list: async () => [],
      findByIds: async (_ids: string[]) => [],
      create: async (_input) => ({
        id: "perm",
        resource: "root",
        action: "access",
      }),
    },
    userRoleRepository: {
      listRolesByUserId: async (_userId: string) => [],
      listUserIdsByRoleId: async (_roleId: string) => [],
      listUserCountByRoleIds: async (roleIds: string[]) =>
        Object.fromEntries(roleIds.map((roleId) => [roleId, 0])),
      setUserRoles: async (_userId: string, _roleIds: string[]) => {},
    },
    rolePermissionRepository: {
      listPermissionsByRoleId: async (_roleId: string) => [],
      setRolePermissions: async (
        _roleId: string,
        _permissionIds: string[],
      ) => {},
    },
    roleDeletionRequestRepository: {
      createPending: async (_input: {
        roleId: string;
        requestedByUserId: string;
        reason?: string;
      }) => {},
      findPendingByRoleId: async (_roleId: string) => null,
      findById: async (_id: string) => null,
      list: async (_input: {
        offset: number;
        limit: number;
        status?: "pending" | "approved" | "rejected" | "cancelled";
        roleId?: string;
      }) => [],
      count: async (_input: {
        status?: "pending" | "approved" | "rejected" | "cancelled";
        roleId?: string;
      }) => 0,
      markApproved: async (_input: { id: string; approvedByUserId: string }) =>
        false,
      markRejected: async (_input: {
        id: string;
        approvedByUserId: string;
        reason?: string;
      }) => false,
    },
    authorizationRepository: {
      findPermissionsForUser: async (_userId: string) =>
        permissions.map((permission) => Permission.parse(permission)),
    },
    policyHistoryRepository: {
      create: async (_input: {
        policyVersion: number;
        changeType: "role_permissions" | "user_roles";
        targetId: string;
        targetType: "role" | "user";
        actorId?: string;
        requestId?: string;
        targetCount: number;
        addedCount: number;
        removedCount: number;
      }) => {},
      list: async (_input: {
        offset: number;
        limit: number;
        policyVersion?: number;
        changeType?: "role_permissions" | "user_roles";
        targetId?: string;
        actorId?: string;
        from?: string;
        to?: string;
      }) => [],
      count: async (_input: {
        policyVersion?: number;
        changeType?: "role_permissions" | "user_roles";
        targetId?: string;
        actorId?: string;
        from?: string;
        to?: string;
      }) => 0,
    },
  };

  app.route(
    "/",
    createRbacRouter({
      jwtSecret: "test-secret",
      repositories,
    }),
  );

  return { app, issueToken: makeIssueToken };
};

describe("API list response contracts", () => {
  test("GET /displays returns canonical list metadata envelope", async () => {
    const { app, issueToken } = await makeDisplaysListApp(["displays:read"]);
    const token = await issueToken();

    const response = await app.request("/displays", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<Record<string, unknown>>;
      meta: {
        total: number;
        page: number;
        per_page: number;
        total_pages: number;
      };
    }>(response);
    expect(body.data).toHaveLength(1);
    expectCanonicalListMeta(body.meta);
  });

  test("GET /content returns canonical list metadata envelope", async () => {
    const { app, issueToken } = await makeContentListApp(["content:read"]);
    const token = await issueToken();

    const response = await app.request("/content", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<Record<string, unknown>>;
      meta: {
        total: number;
        page: number;
        per_page: number;
        total_pages: number;
      };
    }>(response);
    expect(body.data).toHaveLength(1);
    expectCanonicalListMeta(body.meta);
  });

  test("GET /roles returns canonical list metadata envelope", async () => {
    const { app, issueToken } = await makeRbacListApp(["roles:read"]);
    const token = await issueToken();

    const response = await app.request("/roles", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<Record<string, unknown>>;
      meta: {
        total: number;
        page: number;
        per_page: number;
        total_pages: number;
      };
    }>(response);
    expect(body.data).toHaveLength(1);
    expectCanonicalListMeta(body.meta);
  });

  test("GET /users returns canonical list metadata envelope", async () => {
    const { app, issueToken } = await makeRbacListApp(["users:read"]);
    const token = await issueToken();

    const response = await app.request("/users", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: Array<Record<string, unknown>>;
      meta: {
        total: number;
        page: number;
        per_page: number;
        total_pages: number;
      };
    }>(response);
    expect(body.data).toHaveLength(1);
    expectCanonicalListMeta(body.meta);
  });
});
