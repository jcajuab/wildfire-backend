import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type ContentRecord } from "#/application/ports/content";
import { type DisplayRegistrationAttemptStore } from "#/application/ports/display-registration-attempt";
import { type DisplayRecord } from "#/application/ports/displays";
import { type RuntimeControlRepository } from "#/application/ports/runtime-controls";
import { createDisplaysHttpModule } from "#/bootstrap/http/modules";
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
  slug: "lobby-display",
  name: "Lobby",
  fingerprint: null,
  status: "READY",
  location: null,
  ipAddress: null,
  macAddress: null,
  screenWidth: null,
  screenHeight: null,
  output: null,
  orientation: null,
  lastSeenAt: null,
  refreshNonce: 0,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

const makeApp = async (
  permissions: string[] = [],
  options?: {
    schedules?: Array<{
      id: string;
      name: string;
      playlistId: string;
      displayId: string;
      startTime: string;
      endTime: string;
      priority: number;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
    displays?: DisplayRecord[];
    displayGroups?: Array<{
      id: string;
      name: string;
      colorIndex: number;
      displayIds: string[];
      createdAt: string;
      updatedAt: string;
    }>;
    failOnBroadReads?: boolean;
  },
) => {
  const app = new Hono();
  const displays = [...(options?.displays ?? [])];
  const displayGroups = [...(options?.displayGroups ?? [])];
  const pairingCodes = [] as Array<{
    id: string;
    codeHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    ownerId: string;
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
  const pairingSessions = [] as Array<{
    id: string;
    pairingCodeId: string;
    state: "open" | "completed" | "aborted" | "expired";
    challengeNonce: string;
    challengeExpiresAt: string;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  const revokedDisplayIds: string[] = [];
  const setDisplayGroupsCalls: Array<{
    displayId: string;
    groupIds: string[];
  }> = [];
  const searchPageCalls: Array<{
    page: number;
    pageSize: number;
    q?: string;
    status?: string;
    output?: string;
    groupIds?: readonly string[];
    sortBy?: string;
    sortDirection?: string;
  }> = [];
  const registrationAttempts = new Map<
    string,
    {
      attemptId: string;
      ownerId: string;
      codeHash: string | null;
      pairingCodeId: string | null;
    }
  >();
  const openAttemptByUserId = new Map<string, string>();
  const attemptIdByCodeHash = new Map<string, string>();
  const sessionAttemptIdBySessionId = new Map<string, string>();

  const playlists = [
    {
      id: playlistId,
      name: "Morning",
      description: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ];

  const contents: ContentRecord[] = [
    {
      id: contentId,
      title: "Welcome",
      type: "IMAGE",
      status: "READY",
      fileKey: "content/images/a.png",
      checksum: "abc",
      mimeType: "image/png",
      fileSize: 100,
      width: 10,
      height: 10,
      duration: null,
      ownerId: "user-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    },
  ];

  const schedules = options?.schedules ?? [];

  const authorizationRepository = {
    findPermissionsForUser: async () =>
      permissions.map((permission) => Permission.parse(permission)),
  };

  const displayRepository = {
    list: async () => {
      if (options?.failOnBroadReads) {
        throw new Error("displayRepository.list should not be used");
      }
      return displays.map((display) => ({ ...display }));
    },
    listPage: async (input: { page: number; pageSize: number }) => {
      const page = Math.max(1, input.page);
      const pageSize = Math.max(1, input.pageSize);
      const offset = (page - 1) * pageSize;
      const items = displays
        .slice(offset, offset + pageSize)
        .map((display) => ({ ...display }));
      return {
        items,
        total: displays.length,
        page,
        pageSize,
      };
    },
    searchPage: async (input: {
      page: number;
      pageSize: number;
      q?: string;
      status?: "PROCESSING" | "READY" | "LIVE" | "DOWN";
      output?: string;
      groupIds?: readonly string[];
      sortBy?: "name" | "status" | "location";
      sortDirection?: "asc" | "desc";
    }) => {
      searchPageCalls.push(input);
      const normalizedQuery = input.q?.trim().toLowerCase();
      const filtered = displays.filter((display) => {
        if (input.status && display.status !== input.status) {
          return false;
        }
        if (input.output && display.output !== input.output) {
          return false;
        }
        if (input.groupIds && input.groupIds.length > 0) {
          const matchesGroup = displayGroups.some(
            (group) =>
              input.groupIds?.includes(group.id) &&
              group.displayIds.includes(display.id),
          );
          if (!matchesGroup) {
            return false;
          }
        }
        if (!normalizedQuery) {
          return true;
        }
        return [
          display.name,
          display.slug,
          display.location ?? "",
          display.output ?? "",
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      });

      const sorted = [...filtered].sort((left, right) => {
        const direction = input.sortDirection === "desc" ? -1 : 1;
        if (input.sortBy === "status") {
          const statusDelta =
            left.status.localeCompare(right.status) * direction;
          if (statusDelta !== 0) {
            return statusDelta;
          }
        } else if (input.sortBy === "location") {
          const locationDelta =
            (left.location ?? "").localeCompare(right.location ?? "") *
            direction;
          if (locationDelta !== 0) {
            return locationDelta;
          }
        }
        return left.name.localeCompare(right.name) * direction;
      });

      const page = Math.max(1, input.page);
      const pageSize = Math.max(1, input.pageSize);
      const offset = (page - 1) * pageSize;

      return {
        items: sorted.slice(offset, offset + pageSize).map((display) => ({
          ...display,
        })),
        total: sorted.length,
        page,
        pageSize,
      };
    },
    findByIds: async (ids: string[]) =>
      displays
        .filter((display) => ids.includes(display.id))
        .map((display) => ({ ...display })),
    findById: async (id: string) =>
      (() => {
        const found = displays.find((display) => display.id === id);
        return found ? { ...found } : null;
      })(),
    findBySlug: async (slug: string) =>
      (() => {
        const found = displays.find((display) => display.slug === slug);
        return found ? { ...found } : null;
      })(),
    findByFingerprint: async (fingerprint: string) =>
      (() => {
        const found = displays.find(
          (display) => display.fingerprint === fingerprint,
        );
        return found ? { ...found } : null;
      })(),
    findByFingerprintAndOutput: async (fingerprint: string, output: string) =>
      (() => {
        const found = displays.find(
          (display) =>
            display.fingerprint === fingerprint &&
            (display.output ?? null) === output,
        );
        return found ? { ...found } : null;
      })(),
    create: async (input: {
      name: string;
      slug: string;
      fingerprint?: string | null;
      location: string | null;
    }) => {
      const created = makeDisplay({
        id: crypto.randomUUID(),
        name: input.name,
        slug: input.slug,
        fingerprint: input.fingerprint ?? null,
        location: input.location,
      });
      displays.push(created);
      return created;
    },
    createRegisteredDisplay: async (input: {
      slug: string;
      name: string;
      fingerprint: string;
      output: string;
      screenWidth: number;
      screenHeight: number;
      now: Date;
    }) => {
      const created = makeDisplay({
        id: crypto.randomUUID(),
        slug: input.slug,
        name: input.name,
        fingerprint: input.fingerprint,
        output: input.output,
        screenWidth: input.screenWidth,
        screenHeight: input.screenHeight,
        createdAt: input.now.toISOString(),
        updatedAt: input.now.toISOString(),
      });
      displays.push(created);
      return created;
    },
    update: async (
      id: string,
      input: {
        name?: string;
        slug?: string;
        fingerprint?: string | null;
        location?: string | null;
        ipAddress?: string | null;
        macAddress?: string | null;
        screenWidth?: number | null;
        screenHeight?: number | null;
        output?: string | null;
        orientation?: "LANDSCAPE" | "PORTRAIT" | null;
      },
    ) => {
      const record = displays.find((display) => display.id === id);
      if (!record) return null;
      if (input.name !== undefined) record.name = input.name;
      if (input.slug !== undefined) record.slug = input.slug;
      if (input.fingerprint !== undefined) {
        record.fingerprint = input.fingerprint;
      }
      if (input.location !== undefined) record.location = input.location;
      if (input.ipAddress !== undefined) record.ipAddress = input.ipAddress;
      if (input.macAddress !== undefined) record.macAddress = input.macAddress;
      if (input.screenWidth !== undefined)
        record.screenWidth = input.screenWidth;
      if (input.screenHeight !== undefined) {
        record.screenHeight = input.screenHeight;
      }
      if (input.output !== undefined) record.output = input.output;
      if (input.orientation !== undefined)
        record.orientation = input.orientation;
      record.updatedAt = "2025-01-02T00:00:00.000Z";
      return { ...record };
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
    setStatus: async (input: {
      id: string;
      status: "PROCESSING" | "READY" | "LIVE" | "DOWN";
      at: Date;
    }) => {
      const record = displays.find((display) => display.id === input.id);
      if (!record) return;
      record.status = input.status;
      record.updatedAt = input.at.toISOString();
    },
    delete: async (id: string) => {
      const index = displays.findIndex((display) => display.id === id);
      if (index === -1) {
        return false;
      }
      displays.splice(index, 1);
      return true;
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
      ownerId: string;
    }) => {
      const now = new Date();
      const record = {
        id: crypto.randomUUID(),
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        usedAt: null as Date | null,
        ownerId: input.ownerId,
        createdAt: now,
        updatedAt: now,
      };
      pairingCodes.push(record);
      return {
        id: record.id,
        codeHash: record.codeHash,
        expiresAt: record.expiresAt.toISOString(),
        usedAt: null,
        ownerId: record.ownerId,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    },
    consumeValidCode: async () => null,
    invalidateById: async (input: { id: string; now: Date }) => {
      const record = pairingCodes.find(
        (candidate) => candidate.id === input.id,
      );
      if (!record) {
        return;
      }
      record.usedAt = input.now;
      record.updatedAt = input.now;
    },
  };

  const displayPairingSessionRepository = {
    create: async (input: {
      pairingCodeId: string;
      challengeNonce: string;
      challengeExpiresAt: Date;
    }) => {
      const now = new Date().toISOString();
      const record = {
        id: crypto.randomUUID(),
        pairingCodeId: input.pairingCodeId,
        state: "open" as const,
        challengeNonce: input.challengeNonce,
        challengeExpiresAt: input.challengeExpiresAt.toISOString(),
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      pairingSessions.push(record);
      return record;
    },
    findOpenById: async (input: { id: string; now: Date }) =>
      pairingSessions.find(
        (session) =>
          session.id === input.id &&
          session.state === "open" &&
          Date.parse(session.challengeExpiresAt) > input.now.getTime(),
      ) ?? null,
    complete: async (id: string, completedAt: Date) => {
      const record = pairingSessions.find((session) => session.id === id);
      if (!record) {
        return false;
      }
      if (record.state !== "open") {
        return false;
      }
      record.state = "completed";
      record.completedAt = completedAt.toISOString();
      record.updatedAt = completedAt.toISOString();
      return true;
    },
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

  const registrationAttemptStore: DisplayRegistrationAttemptStore = {
    createOrReplaceOpenAttempt: async (input) => {
      const existingAttemptId = openAttemptByUserId.get(input.ownerId);
      let invalidatedPairingCodeId: string | null = null;

      if (existingAttemptId) {
        const existingAttempt = registrationAttempts.get(existingAttemptId);
        if (existingAttempt?.codeHash) {
          attemptIdByCodeHash.delete(existingAttempt.codeHash);
        }
        if (existingAttempt?.pairingCodeId) {
          invalidatedPairingCodeId = existingAttempt.pairingCodeId;
          existingAttempt.codeHash = null;
          existingAttempt.pairingCodeId = null;
        }
      }

      const attemptId = crypto.randomUUID();
      registrationAttempts.set(attemptId, {
        attemptId,
        ownerId: input.ownerId,
        codeHash: input.activeCode.codeHash,
        pairingCodeId: input.activeCode.pairingCodeId,
      });
      openAttemptByUserId.set(input.ownerId, attemptId);
      attemptIdByCodeHash.set(input.activeCode.codeHash, attemptId);

      return { attemptId, invalidatedPairingCodeId };
    },
    rotateCode: async (input) => {
      const attempt = registrationAttempts.get(input.attemptId);
      if (!attempt || attempt.ownerId !== input.ownerId) {
        return null;
      }

      const invalidatedPairingCodeId = attempt.pairingCodeId;
      if (attempt.codeHash) {
        attemptIdByCodeHash.delete(attempt.codeHash);
      }
      attempt.codeHash = input.nextCode.codeHash;
      attempt.pairingCodeId = input.nextCode.pairingCodeId;
      attemptIdByCodeHash.set(input.nextCode.codeHash, input.attemptId);
      return { invalidatedPairingCodeId };
    },
    closeAttempt: async (input) => {
      const attempt = registrationAttempts.get(input.attemptId);
      if (!attempt || attempt.ownerId !== input.ownerId) {
        return null;
      }

      const invalidatedPairingCodeId = attempt.pairingCodeId;
      if (attempt.codeHash) {
        attemptIdByCodeHash.delete(attempt.codeHash);
      }
      if (openAttemptByUserId.get(input.ownerId) === input.attemptId) {
        openAttemptByUserId.delete(input.ownerId);
      }
      attempt.codeHash = null;
      attempt.pairingCodeId = null;
      return { invalidatedPairingCodeId };
    },
    isAttemptOwnedBy: async (input) =>
      registrationAttempts.get(input.attemptId)?.ownerId === input.ownerId,
    consumeCodeHash: async (input) => {
      const attemptId = attemptIdByCodeHash.get(input.codeHash);
      if (!attemptId) {
        return null;
      }
      const attempt = registrationAttempts.get(attemptId);
      if (
        !attempt ||
        attempt.codeHash !== input.codeHash ||
        !attempt.pairingCodeId
      ) {
        return null;
      }

      attemptIdByCodeHash.delete(input.codeHash);
      attempt.codeHash = null;
      const pairingCodeId = attempt.pairingCodeId;
      attempt.pairingCodeId = null;
      return { attemptId, pairingCodeId };
    },
    bindSessionAttempt: async (input) => {
      sessionAttemptIdBySessionId.set(input.sessionId, input.attemptId);
    },
    consumeSessionAttemptId: async (sessionId) => {
      const attemptId = sessionAttemptIdBySessionId.get(sessionId) ?? null;
      sessionAttemptIdBySessionId.delete(sessionId);
      return attemptId;
    },
  };

  const router = createDisplaysRouter(
    createDisplaysHttpModule({
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
      downloadUrlExpiresInSeconds: 3600,
      repositories: {
        displayRepository,
        scheduleRepository: {
          list: async () => {
            if (options?.failOnBroadReads) {
              throw new Error("scheduleRepository.list should not be used");
            }
            return schedules;
          },
          listByDisplay: async (targetDisplayId: string) =>
            schedules.filter(
              (schedule) => schedule.displayId === targetDisplayId,
            ),
          listByDisplayIds: async (displayIds: string[]) =>
            schedules.filter((schedule) =>
              displayIds.includes(schedule.displayId),
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
          delete: async () => false,
          update: async () => null,
        },
        runtimeControlRepository: {
          getGlobal: async () => ({
            id: "global",
            globalEmergencyActive: false,
            globalEmergencyStartedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
          setGlobalEmergencyState: async () => ({
            id: "global",
            globalEmergencyActive: false,
            globalEmergencyStartedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        } as RuntimeControlRepository,
        authorizationRepository,
        displayGroupRepository,
        displayPairingCodeRepository,
        displayPairingSessionRepository,
        displayKeyRepository,
        displayPreviewRepository: {
          upsertLatest: async () => {},
          findLatestByDisplayId: async () => null,
        },
      },
      storage: {
        ensureBucketExists: async () => {},
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async () => "https://example.com/file",
      },
      displayEventPublisher: {
        publish: () => {},
      },
      lifecycleEventPublisher: {
        publish: () => {},
      },
      registrationAttemptStore,
      lifecycleEventSubscription: {
        subscribe: () => () => {},
      },
      registrationAttemptEventPublisher: {
        publish: () => {},
      },
      registrationAttemptEventSubscription: {
        subscribe: () => () => {},
      },
    }),
  );

  app.route("/displays", router);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issueToken = async () =>
    tokenIssuer.issueToken({
      subject: "user-1",
      username: "user",
      email: "user@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      sessionId: crypto.randomUUID(),
      issuer: undefined,
    });

  return {
    app,
    issueToken,
    displays,
    setDisplayGroupsCalls,
    revokedDisplayIds,
    searchPageCalls,
  };
};

describe("Displays routes", () => {
  test("GET /displays/registration-constraints returns backend constraints with displays:create permission", async () => {
    const { app, issueToken } = await makeApp(["displays:create"]);
    const token = await issueToken();

    const response = await app.request("/displays/registration-constraints", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{
      data: {
        slugPattern: string;
        minSlugLength: number;
        maxSlugLength: number;
      };
    }>(response);
    expect(json.data).toEqual({
      slugPattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      minSlugLength: 3,
      maxSlugLength: 120,
    });
  });

  test("GET /displays/registration-constraints returns 403 without displays:create", async () => {
    const { app, issueToken } = await makeApp(["displays:read"]);
    const token = await issueToken();

    const response = await app.request("/displays/registration-constraints", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
  });

  test("POST /displays/registration-attempts issues code with displays:create permission", async () => {
    const { app, issueToken } = await makeApp(["displays:create"]);
    const token = await issueToken();

    const response = await app.request("/displays/registration-attempts", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(201);
    const json = await parseJson<{
      data: {
        attemptId: string;
        code: string;
        expiresAt: string;
      };
    }>(response);
    expect(json.data.attemptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(json.data.code).toMatch(/^\d{6}$/);
    expect(Date.parse(json.data.expiresAt)).toBeGreaterThan(Date.now());
  });

  test("POST /displays/registration-attempts returns 403 without displays:create", async () => {
    const { app, issueToken } = await makeApp(["displays:read"]);
    const token = await issueToken();

    const response = await app.request("/displays/registration-attempts", {
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
      schedules: [
        {
          id: "schedule-1",
          name: "Morning",
          playlistId,
          displayId,
          startTime: "00:00",
          endTime: "23:59",
          priority: 10,
          isActive: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    });
    const token = await issueToken();

    const response = await app.request("/displays", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const json = await parseJson<{
      data: Array<{
        id: string;
        slug: string;
        status: "PROCESSING" | "READY" | "LIVE" | "DOWN";
        nowPlaying?: {
          playlist: string | null;
          title: string | null;
          progress: number;
          duration: number;
        } | null;
      }>;
      meta: {
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      };
    }>(response);

    expect(json.data).toHaveLength(1);
    expect(json.data[0]?.id).toBe(displayId);
    expect(json.data[0]?.slug).toBe("lobby-display");
    expect(json.data[0]?.nowPlaying?.playlist).toBe("Morning");
    expect(json.meta.total).toBe(1);
    expect(json.meta.page).toBe(1);
    expect(json.meta.pageSize).toBe(20);
  });

  test("GET /displays matches any selected group id", async () => {
    const { app, issueToken } = await makeApp(["displays:read"], {
      displays: [
        makeDisplay({ id: "display-1", name: "Lobby", slug: "lobby" }),
        makeDisplay({ id: "display-2", name: "Hallway", slug: "hallway" }),
        makeDisplay({ id: "display-3", name: "Other", slug: "other" }),
      ],
      displayGroups: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Lobby",
          colorIndex: 0,
          displayIds: ["display-1"],
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Hallway",
          colorIndex: 1,
          displayIds: ["display-2"],
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    });
    const token = await issueToken();

    const response = await app.request(
      "/displays?groupIds=11111111-1111-4111-8111-111111111111&groupIds=22222222-2222-4222-8222-222222222222",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(200);
    const body = await parseJson<{ data: Array<{ id: string }> }>(response);
    expect(body.data.map((item) => item.id)).toEqual([
      "display-2",
      "display-1",
    ]);
  });

  test("GET /displays/options/outputs returns unique outputs", async () => {
    const { app, issueToken } = await makeApp(["displays:read"], {
      displays: [
        makeDisplay({ id: "display-1", output: "hdmi-0" }),
        makeDisplay({ id: "display-2", output: "hdmi-1" }),
        makeDisplay({ id: "display-3", output: "hdmi-0" }),
      ],
    });
    const token = await issueToken();

    const response = await app.request("/displays/options/outputs", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{ data: string[] }>(response);
    expect(body.data).toEqual(["hdmi-0", "hdmi-1"]);
  });

  test("GET /displays/options returns filtered display options", async () => {
    const { app, issueToken } = await makeApp(["displays:read"], {
      displays: [
        makeDisplay({ id: "display-1", name: "Lobby East" }),
        makeDisplay({
          id: "display-2",
          name: "Hallway West",
          slug: "hallway-west",
        }),
      ],
    });
    const token = await issueToken();

    const response = await app.request("/displays/options?q=Lobby&limit=1", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{ data: Array<{ id: string; name: string }> }>(
      response,
    );
    expect(body.data).toEqual([{ id: "display-1", name: "Lobby East" }]);
  });

  test("GET /displays uses repository-backed paged search path", async () => {
    const { app, issueToken, searchPageCalls } = await makeApp(
      ["displays:read"],
      {
        failOnBroadReads: true,
        displays: [
          makeDisplay({ id: "display-1", name: "Lobby", slug: "lobby" }),
          makeDisplay({ id: "display-2", name: "Atrium", slug: "atrium" }),
        ],
      },
    );
    const token = await issueToken();

    const response = await app.request("/displays?q=Lobby&page=1&pageSize=10", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(searchPageCalls).toHaveLength(1);
    expect(searchPageCalls[0]?.q).toBe("Lobby");
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
    const json = await parseJson<{
      data: { id: string; slug: string };
    }>(response);
    expect(json.data.id).toBe(displayId);
    expect(json.data.slug).toBe("lobby-display");
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
    const json = await parseJson<{
      data: { name: string; screenWidth: number | null };
    }>(response);
    expect(json.data.name).toBe("Lobby Updated");
    expect(json.data.screenWidth).toBe(1920);
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

  test("POST /displays/:id/unregister revokes key and deletes display", async () => {
    const { app, issueToken, revokedDisplayIds, displays } = await makeApp(
      ["displays:delete"],
      {
        displays: [makeDisplay({ status: "READY" })],
      },
    );
    const token = await issueToken();

    const response = await app.request(`/displays/${displayId}/unregister`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(204);
    expect(revokedDisplayIds).toEqual([displayId]);
    expect(displays).toHaveLength(0);
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

    expect(create.status).toBe(201);
    const created = await parseJson<{ data: { id: string } }>(create);

    const response = await app.request(`/displays/${displayId}/groups`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ groupIds: [created.data.id, created.data.id] }),
    });

    expect(response.status).toBe(204);
    expect(setDisplayGroupsCalls).toEqual([
      {
        displayId,
        groupIds: [created.data.id],
      },
    ]);
  });
});
