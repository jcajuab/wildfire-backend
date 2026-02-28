import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type ContentRecord } from "#/application/ports/content";
import {
  type DisplayRegistrationState,
  type DisplayStateTransitionRecord,
} from "#/application/ports/display-auth";
import { type DisplayRecord } from "#/application/ports/displays";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createDisplaysRouter } from "#/interfaces/http/routes/displays.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const parseJson = async <T>(response: Response) => (await response.json()) as T;
const displayId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const playlistId = "b2c4a3f1-6b18-4f90-9d9b-9e1a2f0d9d45";
const contentId = "9c7b2f9a-2f5d-4bd9-9c9e-1f0c1d9b8c7a";

const makeDisplay = (overrides?: Partial<DisplayRecord>): DisplayRecord => ({
  id: displayId,
  displaySlug: "lobby-display",
  name: "Lobby",
  identifier: "AA:BB",
  displayFingerprint: null,
  registrationState: "active",
  location: null,
  ipAddress: null,
  macAddress: null,
  screenWidth: null,
  screenHeight: null,
  outputType: null,
  displayOutput: null,
  orientation: null,
  lastSeenAt: null,
  refreshNonce: 0,
  registeredAt: null,
  activatedAt: null,
  unregisteredAt: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

const makeApp = async (
  permissions: string[] = [],
  options?: {
    schedules?: Array<{
      id: string;
      seriesId: string;
      name: string;
      playlistId: string;
      displayId: string;
      startTime: string;
      endTime: string;
      dayOfWeek: number;
      priority: number;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
    displays?: DisplayRecord[];
  },
) => {
  const app = new Hono();
  const displays = [...(options?.displays ?? [])];
  const displayGroups = [] as Array<{
    id: string;
    name: string;
    colorIndex: number;
    displayIds: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  const pairingCodes = [] as Array<{
    id: string;
    codeHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  const displayKeys = [] as Array<{
    id: string;
    displayId: string;
    algorithm: "ed25519";
    publicKey: string;
    status: "active" | "revoked";
    revokedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  const stateTransitions: DisplayStateTransitionRecord[] = [];
  const revokedDisplayIds: string[] = [];
  const setDisplayGroupsCalls: Array<{
    displayId: string;
    groupIds: string[];
  }> = [];

  const playlists = [
    {
      id: playlistId,
      name: "Morning",
      description: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ];

  const contents: ContentRecord[] = [
    {
      id: contentId,
      title: "Welcome",
      type: "IMAGE",
      status: "DRAFT",
      fileKey: "content/images/a.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 100,
      width: 10,
      height: 10,
      duration: null,
      createdById: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    },
  ];

  const schedules = options?.schedules ?? [];

  const authorizationRepository = {
    findPermissionsForUser: async () =>
      permissions.map((permission) => Permission.parse(permission)),
  };

  const displayRepository = {
    list: async () => displays.map((display) => ({ ...display })),
    findByIds: async (ids: string[]) =>
      displays
        .filter((display) => ids.includes(display.id))
        .map((display) => ({ ...display })),
    findById: async (id: string) =>
      (() => {
        const found = displays.find((display) => display.id === id);
        return found ? { ...found } : null;
      })(),
    findByIdentifier: async (identifier: string) =>
      (() => {
        const found = displays.find(
          (display) => display.identifier === identifier,
        );
        return found ? { ...found } : null;
      })(),
    findBySlug: async (displaySlug: string) =>
      (() => {
        const found = displays.find(
          (display) => display.displaySlug === displaySlug,
        );
        return found ? { ...found } : null;
      })(),
    findByFingerprint: async (fingerprint: string) =>
      (() => {
        const found = displays.find(
          (display) => display.displayFingerprint === fingerprint,
        );
        return found ? { ...found } : null;
      })(),
    create: async (input: {
      name: string;
      identifier: string;
      displayFingerprint?: string | null;
      location: string | null;
    }) => {
      const created = makeDisplay({
        id: crypto.randomUUID(),
        displaySlug: input.identifier
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-"),
        name: input.name,
        identifier: input.identifier,
        displayFingerprint: input.displayFingerprint ?? null,
        location: input.location,
      });
      displays.push(created);
      return created;
    },
    update: async (
      id: string,
      input: {
        name?: string;
        identifier?: string;
        displayFingerprint?: string | null;
        location?: string | null;
        ipAddress?: string | null;
        macAddress?: string | null;
        screenWidth?: number | null;
        screenHeight?: number | null;
        outputType?: string | null;
        orientation?: "LANDSCAPE" | "PORTRAIT" | null;
      },
    ) => {
      const record = displays.find((display) => display.id === id);
      if (!record) return null;
      if (input.name !== undefined) record.name = input.name;
      if (input.identifier !== undefined) record.identifier = input.identifier;
      if (input.displayFingerprint !== undefined) {
        record.displayFingerprint = input.displayFingerprint;
      }
      if (input.location !== undefined) record.location = input.location;
      if (input.ipAddress !== undefined) record.ipAddress = input.ipAddress;
      if (input.macAddress !== undefined) record.macAddress = input.macAddress;
      if (input.screenWidth !== undefined)
        record.screenWidth = input.screenWidth;
      if (input.screenHeight !== undefined) {
        record.screenHeight = input.screenHeight;
      }
      if (input.outputType !== undefined) record.outputType = input.outputType;
      if (input.orientation !== undefined)
        record.orientation = input.orientation;
      record.updatedAt = "2025-01-02T00:00:00.000Z";
      return { ...record };
    },
    setRegistrationState: async (input: {
      id: string;
      state: DisplayRegistrationState;
      at: Date;
    }) => {
      const record = displays.find((display) => display.id === input.id);
      if (!record) return;
      record.registrationState = input.state;
      if (input.state === "unregistered") {
        record.unregisteredAt = input.at.toISOString();
      }
      record.updatedAt = input.at.toISOString();
    },
    bumpRefreshNonce: async (id: string) => {
      const record = displays.find((display) => display.id === id);
      if (!record) return false;
      record.refreshNonce = (record.refreshNonce ?? 0) + 1;
      return true;
    },
    touchSeen: async (id: string, at: Date) => {
      const record = displays.find((display) => display.id === id);
      if (!record) return;
      record.lastSeenAt = at.toISOString();
    },
  };

  const displayGroupRepository = {
    list: async () => [...displayGroups],
    findById: async (id: string) =>
      displayGroups.find((group) => group.id === id) ?? null,
    findByName: async (name: string) =>
      displayGroups.find((group) => group.name === name) ?? null,
    create: async (input: { name: string; colorIndex: number }) => {
      const record = {
        id: crypto.randomUUID(),
        name: input.name,
        colorIndex: input.colorIndex,
        displayIds: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      displayGroups.push(record);
      return record;
    },
    update: async (
      id: string,
      input: { name?: string; colorIndex?: number },
    ) => {
      const group = displayGroups.find((item) => item.id === id);
      if (!group) return null;
      if (input.name !== undefined) group.name = input.name;
      if (input.colorIndex !== undefined) group.colorIndex = input.colorIndex;
      group.updatedAt = "2025-01-02T00:00:00.000Z";
      return group;
    },
    delete: async (id: string) => {
      const index = displayGroups.findIndex((item) => item.id === id);
      if (index === -1) return false;
      displayGroups.splice(index, 1);
      return true;
    },
    setDisplayGroups: async (displayId: string, groupIds: string[]) => {
      setDisplayGroupsCalls.push({ displayId, groupIds: [...groupIds] });
      for (const group of displayGroups) {
        group.displayIds = group.displayIds.filter((id) => id !== displayId);
      }
      for (const groupId of groupIds) {
        const group = displayGroups.find((item) => item.id === groupId);
        if (group && !group.displayIds.includes(displayId)) {
          group.displayIds.push(displayId);
        }
      }
    },
  };

  const displayPairingCodeRepository = {
    create: async (input: {
      codeHash: string;
      expiresAt: Date;
      createdById: string;
    }) => {
      const now = new Date();
      const record = {
        id: crypto.randomUUID(),
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        usedAt: null as Date | null,
        createdById: input.createdById,
        createdAt: now,
        updatedAt: now,
      };
      pairingCodes.push(record);
      return {
        id: record.id,
        codeHash: record.codeHash,
        expiresAt: record.expiresAt.toISOString(),
        usedAt: null,
        createdById: record.createdById,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    },
    consumeValidCode: async () => null,
  };

  const displayKeyRepository = {
    create: async (input: {
      displayId: string;
      algorithm: "ed25519";
      publicKey: string;
    }) => {
      const now = new Date().toISOString();
      const record = {
        id: crypto.randomUUID(),
        displayId: input.displayId,
        algorithm: input.algorithm,
        publicKey: input.publicKey,
        status: "active" as const,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      displayKeys.push(record);
      return record;
    },
    findActiveByKeyId: async (keyId: string) =>
      displayKeys.find((key) => key.id === keyId && key.status === "active") ??
      null,
    findActiveByDisplayId: async (targetDisplayId: string) =>
      displayKeys.find(
        (key) => key.displayId === targetDisplayId && key.status === "active",
      ) ?? null,
    revokeByDisplayId: async (targetDisplayId: string, at: Date) => {
      revokedDisplayIds.push(targetDisplayId);
      for (const key of displayKeys) {
        if (key.displayId === targetDisplayId && key.status === "active") {
          key.status = "revoked";
          key.revokedAt = at.toISOString();
          key.updatedAt = at.toISOString();
        }
      }
    },
  };

  const displayStateTransitionRepository = {
    create: async (input: {
      displayId: string;
      fromState: DisplayRegistrationState;
      toState: DisplayRegistrationState;
      reason: string;
      actorType: "staff" | "display" | "system";
      actorId?: string | null;
      createdAt: Date;
    }) => {
      const record: DisplayStateTransitionRecord = {
        id: crypto.randomUUID(),
        displayId: input.displayId,
        fromState: input.fromState,
        toState: input.toState,
        reason: input.reason,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        createdAt: input.createdAt.toISOString(),
      };
      stateTransitions.push(record);
      return record;
    },
  };

  const router = createDisplaysRouter({
    jwtSecret: "test-secret",
    downloadUrlExpiresInSeconds: 3600,
    repositories: {
      displayRepository,
      scheduleRepository: {
        list: async () => schedules,
        listByDisplay: async (targetDisplayId: string) =>
          schedules.filter(
            (schedule) => schedule.displayId === targetDisplayId,
          ),
        listByPlaylistId: async () => [],
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        delete: async () => false,
        countByPlaylistId: async () => 0,
      },
      playlistRepository: {
        list: async () => playlists,
        listPage: async ({ offset, limit }) => ({
          items: playlists.slice(offset, offset + limit),
          total: playlists.length,
        }),
        findByIds: async (ids: string[]) =>
          playlists.filter((playlist) => ids.includes(playlist.id)),
        findById: async (id: string) =>
          playlists.find((playlist) => playlist.id === id) ?? null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        updateStatus: async () => undefined,
        delete: async () => false,
        listItems: async () => [],
        findItemById: async () => null,
        countItemsByContentId: async () => 0,
        addItem: async () => {
          throw new Error("not used");
        },
        updateItem: async () => null,
        reorderItems: async () => true,
        deleteItem: async () => false,
      },
      contentRepository: {
        findById: async (id: string) =>
          contents.find((content) => content.id === id) ?? null,
        findByIds: async (ids: string[]) =>
          contents.filter((content) => ids.includes(content.id)),
        create: async () => {
          throw new Error("not used");
        },
        list: async () => ({ items: [], total: 0 }),
        countPlaylistReferences: async () => 0,
        listPlaylistsReferencingContent: async () => [],
        delete: async () => false,
        update: async () => null,
      },
      authorizationRepository,
      displayGroupRepository,
      displayPairingCodeRepository,
      displayKeyRepository,
      displayStateTransitionRepository,
      systemSettingRepository: {
        findByKey: async () => null,
        upsert: async (input: { key: string; value: string }) => ({
          key: input.key,
          value: input.value,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
      },
    },
    storage: {
      upload: async () => {},
      delete: async () => {},
      getPresignedDownloadUrl: async () => "https://example.com/file",
    },
  });

  app.route("/displays", router);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issueToken = async () =>
    tokenIssuer.issueToken({
      subject: "user-1",
      email: "user@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      issuer: undefined,
    });

  return {
    app,
    issueToken,
    displays,
    setDisplayGroupsCalls,
    revokedDisplayIds,
    stateTransitions,
  };
};

describe("Displays routes", () => {
  test("POST /displays/registration-codes issues code with displays:create permission", async () => {
    const { app, issueToken } = await makeApp(["displays:create"]);
    const token = await issueToken();

    const response = await app.request("/displays/registration-codes", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{ code: string; expiresAt: string }>(response);
    expect(json.code).toMatch(/^\d{6}$/);
    expect(Date.parse(json.expiresAt)).toBeGreaterThan(Date.now());
  });

  test("POST /displays/registration-codes returns 403 without displays:create", async () => {
    const { app, issueToken } = await makeApp(["displays:read"]);
    const token = await issueToken();

    const response = await app.request("/displays/registration-codes", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
  });

  test("GET /displays requires permission", async () => {
    const { app, issueToken } = await makeApp([]);
    const token = await issueToken();

    const response = await app.request("/displays", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
  });

  test("GET /displays returns list with permission", async () => {
    const { app, issueToken } = await makeApp(["displays:read"], {
      displays: [makeDisplay({ lastSeenAt: "2025-01-01T00:00:00.000Z" })],
    });
    const token = await issueToken();

    const response = await app.request("/displays", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{
      data: Array<{
        id: string;
        displaySlug: string;
        onlineStatus: "READY" | "LIVE" | "DOWN";
      }>;
      meta: {
        total: number;
        page: number;
        per_page: number;
        total_pages: number;
      };
    }>(response);

    expect(json.data).toHaveLength(1);
    expect(json.data[0]?.id).toBe(displayId);
    expect(json.data[0]?.displaySlug).toBe("lobby-display");
    expect(json.meta.total).toBe(1);
    expect(json.meta.page).toBe(1);
    expect(json.meta.per_page).toBe(50);
  });

  test("GET /displays/:id returns display", async () => {
    const { app, issueToken } = await makeApp(["displays:read"], {
      displays: [makeDisplay()],
    });
    const token = await issueToken();

    const response = await app.request(`/displays/${displayId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{ id: string; displaySlug: string }>(response);
    expect(json.id).toBe(displayId);
    expect(json.displaySlug).toBe("lobby-display");
  });

  test("PATCH /displays/:id updates display with displays:update permission", async () => {
    const { app, issueToken } = await makeApp(["displays:update"], {
      displays: [makeDisplay()],
    });
    const token = await issueToken();

    const response = await app.request(`/displays/${displayId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Lobby Updated",
        screenWidth: 1920,
        screenHeight: 1080,
      }),
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{ name: string; screenWidth: number | null }>(
      response,
    );
    expect(json.name).toBe("Lobby Updated");
    expect(json.screenWidth).toBe(1920);
  });

  test("POST /displays/:id/refresh queues refresh with displays:update permission", async () => {
    const display = makeDisplay({ refreshNonce: 0 });
    const { app, issueToken, displays } = await makeApp(["displays:update"], {
      displays: [display],
    });
    const token = await issueToken();

    const response = await app.request(`/displays/${displayId}/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(204);
    expect(displays[0]?.refreshNonce).toBe(1);
  });

  test("POST /displays/:id/unregister revokes key and records transition", async () => {
    const { app, issueToken, revokedDisplayIds, stateTransitions } =
      await makeApp(["displays:update"], {
        displays: [makeDisplay({ registrationState: "active" })],
      });
    const token = await issueToken();

    const response = await app.request(`/displays/${displayId}/unregister`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(204);
    expect(revokedDisplayIds).toEqual([displayId]);
    expect(stateTransitions).toHaveLength(1);
    expect(stateTransitions[0]?.displayId).toBe(displayId);
    expect(stateTransitions[0]?.fromState).toBe("active");
    expect(stateTransitions[0]?.toState).toBe("unregistered");
  });

  test("PUT /displays/:id/groups deduplicates duplicate group ids", async () => {
    const { app, issueToken, setDisplayGroupsCalls } = await makeApp(
      ["displays:update", "displays:read"],
      {
        displays: [makeDisplay()],
      },
    );
    const token = await issueToken();

    const create = await app.request("/displays/groups", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Lobby", colorIndex: 2 }),
    });

    expect(create.status).toBe(200);
    const created = await parseJson<{ id: string }>(create);

    const response = await app.request(`/displays/${displayId}/groups`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ groupIds: [created.id, created.id] }),
    });

    expect(response.status).toBe(204);
    expect(setDisplayGroupsCalls).toEqual([
      {
        displayId,
        groupIds: [created.id],
      },
    ]);
  });
});
