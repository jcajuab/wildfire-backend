/**
 * Rotation-policy tests.
 *
 * These tests enforce the rotation policy described in the ADR at
 * `.omc/plans/wildfire-media-auth-fix.md`:
 *
 *   Profile and avatar mutation routes MUST NOT rotate the refresh token
 *   (i.e. must not call `refreshSession.execute`). They may reissue a
 *   short-lived access token to reflect updated user state, but the
 *   refresh-token cookie stays untouched.
 *
 *   Password changes are handled by `password.route.ts`, which revokes all
 *   sessions and clears the cookie (204). It does NOT call
 *   `refreshSession.execute` either.
 *
 *   The only legitimate call site of `refreshSession.execute` is the
 *   dedicated refresh endpoint (`session.route.ts`).
 *
 * The grep-guard test below fails if any other source file references
 * `refreshSession.execute`, preventing accidental reintroduction on new
 * mutation endpoints.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import {
  type AuthSessionRepository,
  type CredentialsReader,
  type CredentialsRepository,
  type InvitationRepository,
} from "#/application/ports/auth";
import { type ContentStorage } from "#/application/ports/content";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import { createAuthHttpModule } from "#/bootstrap/http/modules";
import { Permission } from "#/domain/rbac/permission";
import { BcryptPasswordHasher } from "#/infrastructure/auth/bcrypt-password.hasher";
import { BcryptPasswordVerifier } from "#/infrastructure/auth/bcrypt-password.verifier";
import { HtshadowCredentialsRepository } from "#/infrastructure/auth/htshadow.repo";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { normalizeApiPayload } from "#/interfaces/http/responses";
import { createAuthRouter } from "#/interfaces/http/routes/auth";
import { InMemoryAuthSecurityStore } from "../../../../../../tests/helpers/in-memory-auth-security.store";

const fixturePath = path.join(
  import.meta.dir,
  "../../../../../../tests/fixtures/example_htshadow",
);
const tokenTtlSeconds = 60 * 60;
const parseJson = async <T>(response: Response) => (await response.json()) as T;
type ApiData<T> = { data: T };

const createInMemoryDbCredentials = (): CredentialsRepository => {
  const store = new Map<string, string>();
  const fixtureContent = readFileSync(fixturePath, "utf-8");
  const test1Line = fixtureContent
    .split("\n")
    .find((l) => l.startsWith("test1:"));
  if (test1Line) {
    const [, hash] = test1Line.split(":", 2);
    if (hash) store.set("test1", hash.trim());
  }
  return {
    findPasswordHash: async (username) =>
      store.get(username.trim().toLowerCase()) ?? null,
    updatePasswordHash: async (username, newHash) => {
      store.set(username.trim().toLowerCase(), newHash);
    },
    createPasswordHash: async (username, hash) => {
      store.set(username.trim().toLowerCase(), hash);
    },
    listUserIdsWithPasswordHash: async () => [],
  };
};

/**
 * Build a test app whose `refreshSession.execute` has been replaced with a spy
 * that records every call. Any call to it from a route other than
 * `/auth/refresh` violates the rotation policy.
 */
const buildSpyApp = (opts?: { avatarStorage?: ContentStorage }) => {
  const credentialsRepository: CredentialsReader =
    new HtshadowCredentialsRepository({ filePath: fixturePath });
  const dbCredentialsRepository = createInMemoryDbCredentials();
  const passwordVerifier = new BcryptPasswordVerifier();
  const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
  const nowSeconds = Math.floor(Date.now() / 1000);
  const clock = { nowSeconds: () => nowSeconds };

  let currentUser: {
    id: string;
    username: string;
    email: string | null;
    name: string;
    isActive: boolean;
    timezone: string | null;
    avatarKey: string | null;
    invitedAt: string | null;
  } | null = {
    id: "user-1",
    username: "test1",
    email: "test1@example.com",
    name: "Test One",
    isActive: true,
    timezone: null,
    avatarKey: null,
    invitedAt: new Date().toISOString(),
  };

  const userRepository: UserRepository = {
    list: async () => [],
    findByUsername: async (username) =>
      currentUser != null && username === currentUser.username
        ? { ...currentUser }
        : null,
    findByEmail: async (email) =>
      currentUser != null && email === currentUser.email
        ? { ...currentUser }
        : null,
    findById: async (id) =>
      currentUser != null && id === currentUser.id ? { ...currentUser } : null,
    findByIds: async () => [],
    create: async ({ username, email, name, isActive }) => ({
      id: `user-new`,
      username,
      email: email ?? null,
      name,
      isActive: isActive ?? true,
      timezone: null,
      avatarKey: null,
    }),
    update: async (id, input) => {
      if (currentUser == null || id !== currentUser.id) return null;
      currentUser = {
        ...currentUser,
        username: input.username ?? currentUser.username,
        email: input.email === undefined ? currentUser.email : input.email,
        name: input.name ?? currentUser.name,
        isActive: input.isActive ?? currentUser.isActive,
        timezone:
          input.timezone === undefined ? currentUser.timezone : input.timezone,
        avatarKey:
          input.avatarKey === undefined
            ? currentUser.avatarKey
            : input.avatarKey,
      };
      return { ...currentUser };
    },
    delete: async () => true,
  };

  const authorizationRepository: AuthorizationRepository = {
    findPermissionsForUser: async () => [
      new Permission("roles", "read"),
      new Permission("roles", "create"),
    ],
    isAdminUser: async () => false,
  };

  const invitationRepository: InvitationRepository = {
    create: async () => {},
    findActiveByHashedToken: async () => null,
    findById: async () => null,
    findEncryptedTokenById: async () => null,
    countAll: async () => 0,
    listPage: async () => [],
    revokeActiveByEmail: async () => {},
    markAccepted: async () => {},
    deleteExpired: async () => {},
  };

  const defaultAvatarStorage: ContentStorage = {
    ensureBucketExists: async () => {},
    upload: async () => {},
    delete: async () => {},
    getPresignedDownloadUrl: async () => "https://example.com/avatar-presigned",
    checkConnectivity: async () => ({ ok: true }),
  };
  const avatarStorage = opts?.avatarStorage ?? defaultAvatarStorage;

  const sessions = new Map<
    string,
    {
      userId: string;
      expiresAt: Date;
      familyId: string;
      currentJti: string;
      previousJti: string | null;
      previousJtiExpiresAt: Date | null;
    }
  >();
  const revoked = new Set<string>();
  const authSessionRepository: AuthSessionRepository = {
    create: async ({ id, userId, expiresAt, familyId, currentJti }) => {
      sessions.set(id, {
        userId,
        expiresAt,
        familyId,
        currentJti,
        previousJti: null,
        previousJtiExpiresAt: null,
      });
      revoked.delete(id);
    },
    extendExpiry: async (sessionId, expiresAt) => {
      const session = sessions.get(sessionId);
      if (session) sessions.set(sessionId, { ...session, expiresAt });
    },
    revokeById: async (sessionId) => {
      revoked.add(sessionId);
    },
    revokeAllForUser: async (userId) => {
      for (const [id, session] of sessions.entries()) {
        if (session.userId === userId) revoked.add(id);
      }
    },
    isActive: async (sessionId, now) => {
      const session = sessions.get(sessionId);
      if (!session) return !revoked.has(sessionId);
      if (revoked.has(sessionId)) return false;
      return session.expiresAt.getTime() > now.getTime();
    },
    isOwnedByUser: async (sessionId, userId, now) => {
      const session = sessions.get(sessionId);
      if (!session) return !revoked.has(sessionId);
      if (revoked.has(sessionId)) return false;
      if (session.expiresAt.getTime() <= now.getTime()) return false;
      return session.userId === userId;
    },
    findBySessionId: async (sessionId) => {
      if (revoked.has(sessionId)) return null;
      const session = sessions.get(sessionId);
      if (!session) {
        return {
          id: sessionId,
          userId: "user-1",
          familyId: "family-test",
          currentJti: sessionId,
          previousJti: null,
          previousJtiExpiresAt: null,
          expiresAt: new Date(Date.now() + 3600 * 1000),
        };
      }
      if (session.expiresAt.getTime() <= Date.now()) return null;
      return {
        id: sessionId,
        userId: session.userId,
        familyId: session.familyId,
        currentJti: session.currentJti,
        previousJti: session.previousJti,
        previousJtiExpiresAt: session.previousJtiExpiresAt,
        expiresAt: session.expiresAt,
      };
    },
    updateCurrentJtiOptimistic: async ({
      sessionId,
      expectedCurrentJti,
      newJti,
      previousJti,
      previousJtiExpiresAt,
      newExpiresAt,
    }) => {
      const session = sessions.get(sessionId);
      if (!session || session.currentJti !== expectedCurrentJti) return false;
      sessions.set(sessionId, {
        ...session,
        currentJti: newJti,
        previousJti,
        previousJtiExpiresAt,
        expiresAt: newExpiresAt,
      });
      return true;
    },
    revokeByFamilyId: async (familyId) => {
      let count = 0;
      for (const [id, session] of sessions.entries()) {
        if (session.familyId === familyId) {
          revoked.add(id);
          count++;
        }
      }
      return count;
    },
  };

  const module = createAuthHttpModule({
    credentialsRepository,
    dbCredentialsRepository,
    passwordVerifier,
    passwordHasher: new BcryptPasswordHasher(),
    tokenIssuer,
    clock,
    tokenTtlSeconds,
    userRepository,
    authorizationRepository,
    jwtSecret: "test-secret",
    authSessionRepository,
    authSessionCookieName: "wildfire_session_token",
    authSecurityStore: new InMemoryAuthSecurityStore(),
    authLoginRateLimitMaxAttempts: 20,
    authLoginRateLimitWindowSeconds: 60,
    authLoginLockoutThreshold: 10,
    authLoginLockoutSeconds: 60,
    authSessionRateLimitMaxAttempts: 60,
    authSessionRateLimitWindowSeconds: 60,
    trustProxyHeaders: true,
    invitationRepository,
    includeDevelopmentInviteUrls: true,
    inviteTokenTtlSeconds: 3600,
    inviteAcceptBaseUrl: "http://localhost:3000/accept-invite",
    inviteEncryptionKey: "0".repeat(64),
    avatarStorage,
    avatarUrlExpiresInSeconds: 3600,
    secureCookies: false,
    csrfCookieName: "wildfire_csrf",
    authIdentityCache: {
      getPermissions: async () => null,
      setPermissions: async () => {},
      invalidatePermissions: async () => {},
    },
  });

  // Replace refreshSession with a spy that records every invocation.
  // The real implementation is preserved for the /auth/refresh endpoint
  // path (it delegates to the same spied method).
  const originalRefreshSession = module.useCases.refreshSession;
  const calls: Array<unknown> = [];
  module.useCases.refreshSession = {
    execute: async (
      input: Parameters<typeof originalRefreshSession.execute>[0],
    ) => {
      calls.push(input);
      return originalRefreshSession.execute(input);
    },
  } as typeof originalRefreshSession;

  const authRouter = createAuthRouter(module);
  const app = new Hono();
  app.use("*", async (c, next) => {
    const originalJson = c.json.bind(c) as (
      body: unknown,
      ...rest: unknown[]
    ) => Response;
    (c as { json: typeof originalJson }).json = ((
      value: unknown,
      init,
      headers,
    ) => {
      const normalized = normalizeApiPayload(value, {
        requestUrl: c.req.url,
      });
      return originalJson(normalized, init as unknown, headers as unknown);
    }) as typeof originalJson;
    await next();
  });
  app.route("/auth", authRouter);
  return { app, refreshSessionCalls: calls };
};

const loginAsDefaultUser = async (app: Hono): Promise<Response> =>
  app.request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "test1",
      password: "xc4uuicX",
    }),
  });

describe("rotation policy", () => {
  test("PUT /auth/me/avatar does not call refreshSession.execute", async () => {
    const uploads: string[] = [];
    const avatarStorage: ContentStorage = {
      ensureBucketExists: async () => {},
      upload: async ({ key }) => {
        uploads.push(key);
      },
      delete: async () => {},
      getPresignedDownloadUrl: async ({ key }) =>
        `https://example.com/download/${key}`,
      checkConnectivity: async () => ({ ok: true }),
    };

    const { app, refreshSessionCalls } = buildSpyApp({ avatarStorage });
    const loginResponse = await loginAsDefaultUser(app);
    const sessionCookie = loginResponse.headers.get("set-cookie") ?? "";
    const loginBody =
      await parseJson<ApiData<{ accessToken: string }>>(loginResponse);
    const token = loginBody.data.accessToken;

    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", {
        type: "image/png",
      }),
    );

    const response = await app.request("/auth/me/avatar", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, Cookie: sessionCookie },
      body: form,
    });

    expect(response.status).toBe(200);
    expect(uploads).toEqual(["avatars/user-1"]);
    expect(refreshSessionCalls).toHaveLength(0);
  });

  test("PUT /auth/me/avatar does not set refresh-token cookie", async () => {
    const avatarStorage: ContentStorage = {
      ensureBucketExists: async () => {},
      upload: async () => {},
      delete: async () => {},
      getPresignedDownloadUrl: async () => "https://example.com/avatar",
      checkConnectivity: async () => ({ ok: true }),
    };

    const { app } = buildSpyApp({ avatarStorage });
    const loginResponse = await loginAsDefaultUser(app);
    const sessionCookie = loginResponse.headers.get("set-cookie") ?? "";
    const loginBody =
      await parseJson<ApiData<{ accessToken: string }>>(loginResponse);
    const token = loginBody.data.accessToken;

    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", {
        type: "image/png",
      }),
    );

    const response = await app.request("/auth/me/avatar", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, Cookie: sessionCookie },
      body: form,
    });

    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""].filter(Boolean);
    expect(
      setCookies.some((value) => value.includes("wildfire_session_token=")),
    ).toBe(false);
  });

  test("PATCH /auth/profile { name } does not call refreshSession.execute", async () => {
    const { app, refreshSessionCalls } = buildSpyApp();
    const loginResponse = await loginAsDefaultUser(app);
    const sessionCookie = loginResponse.headers.get("set-cookie") ?? "";
    const loginBody =
      await parseJson<ApiData<{ accessToken: string }>>(loginResponse);
    const token = loginBody.data.accessToken;

    const response = await app.request("/auth/profile", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: sessionCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "New Name" }),
    });

    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""].filter(Boolean);
    expect(
      setCookies.some((value) => value.includes("wildfire_session_token=")),
    ).toBe(false);
    expect(refreshSessionCalls).toHaveLength(0);
  });

  test("PATCH /auth/profile { email } does not call refreshSession.execute", async () => {
    const { app, refreshSessionCalls } = buildSpyApp();
    const loginResponse = await loginAsDefaultUser(app);
    const sessionCookie = loginResponse.headers.get("set-cookie") ?? "";
    const loginBody =
      await parseJson<ApiData<{ accessToken: string }>>(loginResponse);
    const token = loginBody.data.accessToken;

    const response = await app.request("/auth/profile", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: sessionCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "new@example.com" }),
    });

    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""].filter(Boolean);
    expect(
      setCookies.some((value) => value.includes("wildfire_session_token=")),
    ).toBe(false);
    expect(refreshSessionCalls).toHaveLength(0);
  });

  /**
   * Grep-guard: the only call sites of `refreshSession.execute` should be the
   * refresh endpoint itself. Any other match is a regression that would
   * reintroduce the race-causing rotation on a non-refresh endpoint.
   *
   * Allowed call sites (confirmed 2026-04-20):
   *   - src/interfaces/http/routes/auth/session.route.ts (the /auth/refresh
   *     endpoint — the intended, single legitimate caller)
   *
   * Note: login.route.ts does NOT call refreshSession.execute; it uses
   * authenticateUser.execute instead (which mints its own initial tokens).
   * password.route.ts revokes sessions directly and does not call it either.
   */
  test("grep-guard: only session.route.ts references refreshSession.execute", () => {
    const backendSrc = path.resolve(import.meta.dir, "../../../../../..");
    const srcRoot = path.join(backendSrc, "src");

    const allowed = new Set<string>([
      path.join(srcRoot, "interfaces/http/routes/auth/session.route.ts"),
    ]);

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          if (entry === "__tests__" || entry === "node_modules") continue;
          walk(full);
          continue;
        }
        if (!full.endsWith(".ts")) continue;
        const contents = readFileSync(full, "utf-8");
        if (contents.includes("refreshSession.execute")) {
          if (!allowed.has(full)) offenders.push(full);
        }
      }
    };
    walk(srcRoot);

    expect(offenders).toEqual([]);
  });
});
