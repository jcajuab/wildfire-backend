import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { type ContentRecord } from "#/application/ports/content";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createDisplaysRouter } from "#/interfaces/http/routes/displays.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const parseJson = async <T>(response: Response) => (await response.json()) as T;
const displayId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const playlistId = "b2c4a3f1-6b18-4f90-9d9b-9e1a2f0d9d45";
const contentId = "9c7b2f9a-2f5d-4bd9-9c9e-1f0c1d9b8c7a";
const hashPairingCode = (code: string): string =>
  createHash("sha256").update(code).digest("hex");
const utcDayOfWeekNow = () => new Date().getUTCDay();

const makeRepositories = (options?: { registerDisplayError?: Error }) => {
  const displays = [] as Array<{
    id: string;
    name: string;
    identifier: string;
    displayFingerprint: string | null;
    location: string | null;
    screenWidth: number | null;
    screenHeight: number | null;
    outputType: string | null;
    orientation: "LANDSCAPE" | "PORTRAIT" | null;
    lastSeenAt?: string | null;
    refreshNonce: number;
    createdAt: string;
    updatedAt: string;
  }>;
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
  const setDisplayGroupsCalls: Array<{
    displayId: string;
    groupIds: string[];
  }> = [];

  return {
    displays,
    displayGroups,
    setDisplayGroupsCalls,
    issuePairingCode: (code: string, expiresAt?: Date) => {
      pairingCodes.push({
        id: crypto.randomUUID(),
        codeHash: hashPairingCode(code),
        expiresAt: expiresAt ?? new Date(Date.now() + 10 * 60 * 1000),
        usedAt: null,
        createdById: "user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    },
    displayRepository: {
      list: async () => [...displays],
      findByIds: async (ids: string[]) =>
        displays.filter((display) => ids.includes(display.id)),
      findById: async (id: string) =>
        displays.find((display) => display.id === id) ?? null,
      findByIdentifier: async (identifier: string) =>
        displays.find((display) => display.identifier === identifier) ?? null,
      findByFingerprint: async (fingerprint: string) =>
        displays.find(
          (display) => display.displayFingerprint === fingerprint,
        ) ?? null,
      create: async (input: {
        name: string;
        identifier: string;
        displayFingerprint?: string | null;
        location: string | null;
      }) => {
        if (options?.registerDisplayError) {
          throw options.registerDisplayError;
        }
        const record = {
          id: `display-${displays.length + 1}`,
          ...input,
          displayFingerprint: input.displayFingerprint ?? null,
          screenWidth: null,
          screenHeight: null,
          outputType: null,
          orientation: null,
          refreshNonce: 0,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        };
        displays.push(record);
        return record;
      },
      update: async (
        id: string,
        input: {
          name?: string;
          identifier?: string;
          displayFingerprint?: string | null;
          location?: string | null;
          screenWidth?: number | null;
          screenHeight?: number | null;
          outputType?: string | null;
          orientation?: "LANDSCAPE" | "PORTRAIT" | null;
        },
      ) => {
        const record = displays.find((display) => display.id === id);
        if (!record) return null;
        if (input.name !== undefined) record.name = input.name;
        if (input.identifier !== undefined)
          record.identifier = input.identifier;
        if (input.displayFingerprint !== undefined)
          record.displayFingerprint = input.displayFingerprint;
        if (input.location !== undefined) record.location = input.location;
        if (input.screenWidth !== undefined)
          record.screenWidth = input.screenWidth;
        if (input.screenHeight !== undefined)
          record.screenHeight = input.screenHeight;
        if (input.outputType !== undefined)
          record.outputType = input.outputType;
        if (input.orientation !== undefined)
          record.orientation = input.orientation;
        record.updatedAt = "2025-01-02T00:00:00.000Z";
        return record;
      },
      bumpRefreshNonce: async (id: string) => {
        const record = displays.find((display) => display.id === id);
        if (!record) return false;
        record.refreshNonce += 1;
        return true;
      },
    },
    displayGroupRepository: {
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
    },
    displayPairingCodeRepository: {
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
      consumeValidCode: async ({
        codeHash,
        now,
      }: {
        codeHash: string;
        now: Date;
      }) => {
        const record = pairingCodes.find(
          (item) =>
            item.codeHash === codeHash &&
            item.usedAt === null &&
            item.expiresAt.getTime() > now.getTime(),
        );
        if (!record) return null;
        record.usedAt = now;
        record.updatedAt = now;
        return {
          id: record.id,
          codeHash: record.codeHash,
          expiresAt: record.expiresAt.toISOString(),
          usedAt: record.usedAt.toISOString(),
          createdById: record.createdById,
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
        };
      },
    },
  };
};

const makeApp = async (
  permissions: string[] = [],
  options?: {
    registerDisplayError?: Error;
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
  },
) => {
  const app = new Hono();
  const {
    displays,
    setDisplayGroupsCalls,
    issuePairingCode,
    displayRepository,
    displayGroupRepository,
    displayPairingCodeRepository,
  } = makeRepositories(options);
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
  const authorizationRepository = {
    findPermissionsForUser: async () =>
      permissions.map((permission) => Permission.parse(permission)),
  };
  const schedules = options?.schedules ?? [];

  const router = createDisplaysRouter({
    jwtSecret: "test-secret",
    displayApiKey: "display-key",
    downloadUrlExpiresInSeconds: 3600,
    repositories: {
      displayRepository,
      scheduleRepository: {
        list: async () => schedules,
        listByDisplay: async (displayId: string) =>
          schedules.filter((schedule) => schedule.displayId === displayId),
        findById: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        delete: async () => false,
        countByPlaylistId: async () => 0,
        listBySeries: async () => [],
        deleteBySeries: async () => 0,
        listByPlaylistId: async () => [],
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
        listItems: async () => [
          {
            id: "item-1",
            playlistId,
            contentId,
            sequence: 10,
            duration: 5,
          },
        ],
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
      systemSettingRepository: {
        findByKey: async () => null,
        upsert: async () => ({
          key: "display_runtime_scroll_px_per_second",
          value: "24",
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

  return { app, issueToken, displays, setDisplayGroupsCalls, issuePairingCode };
};

describe("Displays routes", () => {
  test("POST /displays registers display with pairing code", async () => {
    const { app, issuePairingCode } = await makeApp();
    issuePairingCode("123456");
    const response = await app.request("/displays", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pairingCode: "123456",
        name: "Lobby",
        identifier: "AA:BB",
        location: "Hall",
        screenWidth: 1366,
        screenHeight: 768,
      }),
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{
      id: string;
      onlineStatus: "READY" | "LIVE" | "DOWN";
      lastSeenAt: string | null;
    }>(response);
    expect(json.id).toBeDefined();
    expect(json.onlineStatus).toBe("READY");
    expect(json.lastSeenAt).not.toBeNull();
  });

  test("POST /displays returns 400 without pairing code", async () => {
    const { app } = await makeApp();
    const response = await app.request("/displays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Lobby", identifier: "AA:BB" }),
    });

    expect(response.status).toBe(422);
  });

  test("POST /displays returns 500 on unexpected repository failure", async () => {
    const { app, issuePairingCode } = await makeApp([], {
      registerDisplayError: new Error("db unavailable"),
    });
    issuePairingCode("223456");
    const response = await app.request("/displays", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pairingCode: "223456",
        name: "Lobby",
        identifier: "AA:BB",
        screenWidth: 1366,
        screenHeight: 768,
      }),
    });

    expect(response.status).toBe(500);
  });

  test("POST /displays reuses existing display when fingerprint matches", async () => {
    const { app, displays, issuePairingCode } = await makeApp();
    issuePairingCode("323456");
    const first = await app.request("/displays", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pairingCode: "323456",
        name: "Lobby",
        identifier: "display-one",
        displayFingerprint: "fp-1",
        screenWidth: 1366,
        screenHeight: 768,
      }),
    });
    const firstBody = await parseJson<{ id: string }>(first);

    issuePairingCode("423456");
    const second = await app.request("/displays", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pairingCode: "423456",
        name: "Lobby Updated",
        identifier: "display-two",
        displayFingerprint: "fp-1",
        screenWidth: 1920,
        screenHeight: 1080,
      }),
    });

    expect(second.status).toBe(200);
    const secondBody = await parseJson<{ id: string; identifier: string }>(
      second,
    );
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.identifier).toBe("display-two");
    expect(displays).toHaveLength(1);
  });

  test("POST /displays rejects conflicting identifier and fingerprint", async () => {
    const { app, issuePairingCode } = await makeApp();

    issuePairingCode("523456");
    await app.request("/displays", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pairingCode: "523456",
        name: "Display A",
        identifier: "display-a",
        displayFingerprint: "fp-a",
        screenWidth: 1366,
        screenHeight: 768,
      }),
    });

    issuePairingCode("623456");
    await app.request("/displays", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pairingCode: "623456",
        name: "Display B",
        identifier: "display-b",
        displayFingerprint: "fp-b",
        screenWidth: 1366,
        screenHeight: 768,
      }),
    });

    issuePairingCode("723456");
    const conflict = await app.request("/displays", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pairingCode: "723456",
        name: "Conflict",
        identifier: "display-a",
        displayFingerprint: "fp-b",
        screenWidth: 1366,
        screenHeight: 768,
      }),
    });

    expect(conflict.status).toBe(422);
  });

  test("POST /displays/pairing-codes issues code with displays:create permission", async () => {
    const { app, issueToken } = await makeApp(["displays:create"]);
    const token = await issueToken();
    const response = await app.request("/displays/pairing-codes", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{ code: string; expiresAt: string }>(response);
    expect(json.code).toMatch(/^\d{6}$/);
    expect(Date.parse(json.expiresAt)).toBeGreaterThan(Date.now());
  });

  test("POST /displays/pairing-codes returns 403 without displays:create", async () => {
    const { app, issueToken } = await makeApp(["displays:read"]);
    const token = await issueToken();
    const response = await app.request("/displays/pairing-codes", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
  });

  test("GET /displays/:id/manifest returns 401 without API key", async () => {
    const { app } = await makeApp();
    const response = await app.request(`/displays/${displayId}/manifest`);
    expect(response.status).toBe(401);
  });

  test("GET /displays/:id/active-schedule returns 401 without API key", async () => {
    const { app } = await makeApp();
    const response = await app.request(
      `/displays/${displayId}/active-schedule`,
    );
    expect(response.status).toBe(401);
  });

  test("GET /displays/:id/stream-token returns 401 without API key", async () => {
    const { app } = await makeApp();
    const response = await app.request(`/displays/${displayId}/stream-token`);
    expect(response.status).toBe(401);
  });

  test("GET /displays/:id/stream rejects invalid stream token", async () => {
    const { app } = await makeApp();
    const response = await app.request(
      `/displays/${displayId}/stream?streamToken=invalid`,
    );
    expect(response.status).toBe(401);
  });

  test("GET /displays/:id/stream returns event-stream for valid token", async () => {
    const { app } = await makeApp();
    const tokenResponse = await app.request(
      `/displays/${displayId}/stream-token`,
      {
        headers: { "X-API-Key": "display-key" },
      },
    );
    expect(tokenResponse.status).toBe(200);
    const tokenBody = await parseJson<{ token: string }>(tokenResponse);

    const response = await app.request(
      `/displays/${displayId}/stream?streamToken=${encodeURIComponent(tokenBody.token)}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
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
    const { app, issueToken, displays } = await makeApp(["displays:read"]);
    displays.push({
      id: displayId,
      name: "Lobby",
      identifier: "AA:BB",
      displayFingerprint: null,
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request("/displays", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{
      items: Array<{ id: string }>;
      total: number;
      page: number;
      pageSize: number;
    }>(response);
    expect(json.items).toHaveLength(1);
    expect(json.total).toBe(1);
    expect(json.page).toBe(1);
    expect(json.pageSize).toBe(50);
  });

  test("GET /displays returns DOWN for stale but previously seen displays", async () => {
    const { app, issueToken, displays } = await makeApp(["displays:read"]);
    displays.push({
      id: displayId,
      name: "Lobby",
      identifier: "AA:BB",
      displayFingerprint: null,
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      lastSeenAt: "2025-01-01T00:00:00.000Z",
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request("/displays", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{
      items: Array<{
        id: string;
        onlineStatus: "READY" | "LIVE" | "DOWN";
        lastSeenAt: string | null;
      }>;
    }>(response);
    expect(json.items[0]?.onlineStatus).toBe("DOWN");
    expect(json.items[0]?.lastSeenAt).toBe("2025-01-01T00:00:00.000Z");
  });

  test("GET /displays returns LIVE for recently seen displays with active schedule", async () => {
    const nowIso = new Date().toISOString();
    const { app, issueToken, displays } = await makeApp(["displays:read"], {
      schedules: [
        {
          id: "schedule-live",
          seriesId: "series-live",
          name: "Always on",
          playlistId,
          displayId,
          startTime: "00:00",
          endTime: "23:59",
          dayOfWeek: utcDayOfWeekNow(),
          priority: 100,
          isActive: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    });
    displays.push({
      id: displayId,
      name: "Lobby",
      identifier: "AA:BB",
      displayFingerprint: null,
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      lastSeenAt: nowIso,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request("/displays", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{
      items: Array<{ onlineStatus: "READY" | "LIVE" | "DOWN" }>;
    }>(response);
    expect(json.items[0]?.onlineStatus).toBe("LIVE");
  });

  test("GET /displays/:id returns display", async () => {
    const { app, issueToken, displays } = await makeApp(["displays:read"]);
    displays.push({
      id: displayId,
      name: "Lobby",
      identifier: "AA:BB",
      displayFingerprint: null,
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request(`/displays/${displayId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
  });

  test("PATCH /displays/:id updates display with displays:update permission", async () => {
    const { app, issueToken, displays } = await makeApp(["displays:update"]);
    displays.push({
      id: displayId,
      name: "Lobby",
      identifier: "AA:BB",
      displayFingerprint: null,
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    const token = await issueToken();

    const response = await app.request(`/displays/${displayId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Lobby TV",
        location: "Main Hall",
        outputType: "HDMI-0",
        screenWidth: 1920,
        screenHeight: 1080,
        orientation: "LANDSCAPE",
      }),
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{
      name: string;
      location: string | null;
      outputType: string | null;
      screenWidth: number | null;
      screenHeight: number | null;
      orientation: "LANDSCAPE" | "PORTRAIT" | null;
    }>(response);
    expect(json.name).toBe("Lobby TV");
    expect(json.location).toBe("Main Hall");
    expect(json.outputType).toBe("HDMI-0");
    expect(json.screenWidth).toBe(1920);
    expect(json.screenHeight).toBe(1080);
    expect(json.orientation).toBe("LANDSCAPE");
  });

  test("POST /displays/:id/refresh queues refresh with displays:update permission", async () => {
    const { app, issueToken, displays } = await makeApp(["displays:update"]);
    displays.push({
      id: displayId,
      name: "Lobby",
      identifier: "AA:BB",
      displayFingerprint: null,
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request(`/displays/${displayId}/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(204);
    expect(displays[0]?.refreshNonce).toBe(1);
  });

  test("POST /displays/:id/refresh returns 403 without permission", async () => {
    const { app, issueToken, displays } = await makeApp(["displays:read"]);
    displays.push({
      id: displayId,
      name: "Lobby",
      identifier: "AA:BB",
      displayFingerprint: null,
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const response = await app.request(`/displays/${displayId}/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
  });

  test("POST /displays/:id/refresh returns 404 for missing display", async () => {
    const { app, issueToken } = await makeApp(["displays:update"]);
    const token = await issueToken();

    const response = await app.request(`/displays/${displayId}/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(404);
  });

  test("GET /displays/groups returns groups with displays:read permission", async () => {
    const { app, issueToken, displays } = await makeApp(["displays:read"]);
    displays.push({
      id: displayId,
      name: "Lobby",
      identifier: "AA:BB",
      displayFingerprint: null,
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const token = await issueToken();
    const createResponse = await app.request("/displays/groups", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Lobby Group" }),
    });
    expect(createResponse.status).toBe(403);

    const elevated = await makeApp(["displays:read", "displays:update"]);
    const elevatedToken = await elevated.issueToken();
    const createOk = await elevated.app.request("/displays/groups", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${elevatedToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Lobby Group" }),
    });
    expect(createOk.status).toBe(200);

    const listResponse = await elevated.app.request("/displays/groups", {
      headers: { Authorization: `Bearer ${elevatedToken}` },
    });
    expect(listResponse.status).toBe(200);
    const json = await parseJson<{ items: Array<{ name: string }> }>(
      listResponse,
    );
    expect(json.items.some((group) => group.name === "Lobby Group")).toBe(true);
  });

  test("PATCH /displays/groups/:groupId returns 409 for case-insensitive rename conflicts", async () => {
    const { app, issueToken } = await makeApp(["displays:update"]);
    const token = await issueToken();

    const firstCreate = await app.request("/displays/groups", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Lobby" }),
    });
    const secondCreate = await app.request("/displays/groups", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Office" }),
    });

    expect(firstCreate.status).toBe(200);
    expect(secondCreate.status).toBe(200);
    const second = await parseJson<{ id: string }>(secondCreate);

    const response = await app.request(`/displays/groups/${second.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "  LOBBY  " }),
    });

    expect(response.status).toBe(409);
  });

  test("PUT /displays/:id/groups deduplicates duplicate group ids", async () => {
    const { app, issueToken, displays, setDisplayGroupsCalls } = await makeApp([
      "displays:update",
    ]);
    displays.push({
      id: displayId,
      name: "Lobby",
      identifier: "AA:BB",
      displayFingerprint: null,
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    const token = await issueToken();

    const create = await app.request("/displays/groups", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Lobby Group" }),
    });
    expect(create.status).toBe(200);
    const created = await parseJson<{ id: string }>(create);

    const response = await app.request(`/displays/${displayId}/groups`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        groupIds: [created.id, created.id, created.id],
      }),
    });

    expect(response.status).toBe(204);
    expect(setDisplayGroupsCalls).toEqual([
      {
        displayId,
        groupIds: [created.id],
      },
    ]);
  });

  test("DELETE /displays/groups/:groupId removes the group and blocks future assignment", async () => {
    const { app, issueToken, displays } = await makeApp([
      "displays:update",
      "displays:read",
    ]);
    displays.push({
      id: displayId,
      name: "Lobby",
      identifier: "AA:BB",
      displayFingerprint: null,
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    const token = await issueToken();

    const create = await app.request("/displays/groups", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Temp Group" }),
    });
    expect(create.status).toBe(200);
    const created = await parseJson<{ id: string }>(create);

    const assign = await app.request(`/displays/${displayId}/groups`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ groupIds: [created.id] }),
    });
    expect(assign.status).toBe(204);

    const remove = await app.request(`/displays/groups/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(remove.status).toBe(204);

    const list = await app.request("/displays/groups", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(list.status).toBe(200);
    const groupsList = await parseJson<{ items: Array<{ id: string }> }>(list);
    expect(groupsList.items.some((group) => group.id === created.id)).toBe(
      false,
    );

    const reassignDeleted = await app.request(`/displays/${displayId}/groups`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ groupIds: [created.id] }),
    });
    expect(reassignDeleted.status).toBe(404);
  });

  test("GET /displays/:id/manifest returns empty manifest", async () => {
    const { app, displays } = await makeApp();
    displays.push({
      id: displayId,
      name: "Lobby",
      identifier: "AA:BB",
      displayFingerprint: null,
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const response = await app.request(`/displays/${displayId}/manifest`, {
      headers: { "X-API-Key": "display-key" },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{ playlistId: string | null }>(response);
    expect(json.playlistId).toBeNull();
  });

  test("GET /displays/:id/active-schedule returns null when none", async () => {
    const { app, displays } = await makeApp();
    displays.push({
      id: displayId,
      name: "Lobby",
      identifier: "AA:BB",
      displayFingerprint: null,
      location: null,
      screenWidth: null,
      screenHeight: null,
      outputType: null,
      orientation: null,
      refreshNonce: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const response = await app.request(
      `/displays/${displayId}/active-schedule`,
      {
        headers: { "X-API-Key": "display-key" },
      },
    );

    expect(response.status).toBe(200);
    const json = await parseJson<unknown>(response);
    expect(json).toBeNull();
  });
});
