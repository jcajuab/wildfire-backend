import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type SystemSettingRecord } from "#/application/ports/settings";
import { Permission } from "#/domain/rbac/permission";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createSettingsRouter } from "#/interfaces/http/routes/settings.route";

const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
const parseJson = async <T>(response: Response) => (await response.json()) as T;

const makeApp = async (permissions: string[]) => {
  const app = new Hono();
  const store = new Map<string, SystemSettingRecord>();
  const router = createSettingsRouter({
    jwtSecret: "test-secret",
    repositories: {
      authorizationRepository: {
        findPermissionsForUser: async () =>
          permissions.map((permission) => Permission.parse(permission)),
      },
      systemSettingRepository: {
        findByKey: async (key: string) => store.get(key) ?? null,
        upsert: async (input: { key: string; value: string }) => {
          const now = new Date().toISOString();
          const existing = store.get(input.key);
          const record: SystemSettingRecord = {
            key: input.key,
            value: input.value,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          store.set(input.key, record);
          return record;
        },
      },
      deviceRepository: {
        list: async () => [
          {
            id: "device-1",
            name: "Lobby",
            identifier: "AA:BB",
            location: null,
            screenWidth: 1366,
            screenHeight: 768,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        findByIds: async () => [],
        findById: async () => null,
        findByIdentifier: async () => null,
        findByFingerprint: async () => null,
        create: async () => {
          throw new Error("not used");
        },
        update: async () => null,
        bumpRefreshNonce: async () => false,
      },
    },
  });
  app.route("/settings", router);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const issueToken = async () =>
    tokenIssuer.issueToken({
      subject: "user-1",
      email: "user@example.com",
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3600,
      issuer: undefined,
    });
  return { app, issueToken };
};

describe("Settings routes", () => {
  test("GET /settings/device-runtime returns defaults with settings:read", async () => {
    const { app, issueToken } = await makeApp(["settings:read"]);
    const token = await issueToken();
    const response = await app.request("/settings/device-runtime", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await parseJson<{ scrollPxPerSecond: number }>(response);
    expect(body.scrollPxPerSecond).toBe(24);
  });

  test("PATCH /settings/device-runtime updates value with settings:update", async () => {
    const { app, issueToken } = await makeApp([
      "settings:update",
      "settings:read",
    ]);
    const token = await issueToken();
    const response = await app.request("/settings/device-runtime", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scrollPxPerSecond: 40 }),
    });
    expect(response.status).toBe(200);
    const body = await parseJson<{ scrollPxPerSecond: number }>(response);
    expect(body.scrollPxPerSecond).toBe(40);
  });

  test("PATCH /settings/device-runtime returns 403 without permission", async () => {
    const { app, issueToken } = await makeApp(["settings:read"]);
    const token = await issueToken();
    const response = await app.request("/settings/device-runtime", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scrollPxPerSecond: 40 }),
    });
    expect(response.status).toBe(403);
  });
});
