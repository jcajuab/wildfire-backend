import { describe, expect, test } from "bun:test";
import path from "node:path";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import {
  type AuthSessionRepository,
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
import { createAuthRouter } from "#/interfaces/http/routes/auth.route";
import { InMemoryAuthSecurityStore } from "../../helpers/in-memory-auth-security.store";

const fixturePath = path.join(
  import.meta.dir,
  "../../fixtures/example_htshadow",
);
const tokenTtlSeconds = 60 * 60;
const parseJson = async <T>(response: Response) => (await response.json()) as T;
type ApiData<T> = { data: T };

const DEACTIVATED_MESSAGE =
  "Your account is currently deactivated. Please contact your administrator.";

const buildApp = (opts?: {
  inactiveUsername?: string;
  avatarStorage?: ContentStorage;
  credentialsRepository?: CredentialsRepository;
  permissions?: Permission[];
  invitationEmailSender?: {
    sendInvite: (input: {
      email: string;
      inviteUrl: string;
      expiresAt: Date;
    }) => Promise<void>;
  };
}) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const inactiveUsername = opts?.inactiveUsername;
  const credentialsRepository =
    opts?.credentialsRepository ??
    new HtshadowCredentialsRepository({
      filePath: fixturePath,
    });
  const passwordVerifier = new BcryptPasswordVerifier();
  const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
  const clock = { nowSeconds: () => nowSeconds };
  let currentUser: {
    id: string;
    username: string;
    email: string | null;
    name: string;
    isActive: boolean;
    timezone: string | null;
    avatarKey: string | null;
  } | null = {
    id: "user-1",
    username: "test1",
    email: "test1@example.com",
    name: "Test One",
    isActive: inactiveUsername !== "test1",
    timezone: null,
    avatarKey: null,
  };
  const invitedUsers = new Map<
    string,
    {
      id: string;
      username: string;
      email: string | null;
      name: string;
      isActive: boolean;
      timezone: string | null;
      avatarKey: string | null;
    }
  >();

  const userRepository: UserRepository = {
    list: async () => [],
    findByUsername: async (username: string) =>
      currentUser != null && username === currentUser.username
        ? { ...currentUser }
        : (invitedUsers.get(username) ?? null),
    findByEmail: async (email: string) =>
      currentUser != null && email === currentUser.email
        ? { ...currentUser }
        : ([...invitedUsers.values()].find((user) => user.email === email) ??
          null),
    findById: async (id: string) =>
      currentUser != null && id === currentUser.id
        ? { ...currentUser }
        : ([...invitedUsers.values()].find((user) => user.id === id) ?? null),
    findByIds: async () => [],
    create: async ({ username, email, name, isActive }) => {
      const user = {
        id: `user-${invitedUsers.size + 2}`,
        username,
        email: email ?? null,
        name,
        isActive: isActive ?? true,
        timezone: null,
        avatarKey: null,
      };
      invitedUsers.set(username, user);
      return user;
    },
    update: async (id, input) => {
      if (currentUser == null || id !== currentUser.id) {
        return null;
      }
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
    delete: async (id) => {
      if (currentUser == null || id !== currentUser.id) {
        for (const [username, user] of invitedUsers.entries()) {
          if (user.id === id) {
            invitedUsers.delete(username);
            return true;
          }
        }
        return false;
      }
      currentUser = null;
      return true;
    },
  };

  const authorizationRepository: AuthorizationRepository = {
    findPermissionsForUser: async (userId: string) =>
      userId === "user-1"
        ? (opts?.permissions ?? [
            new Permission("roles", "read"),
            new Permission("roles", "create"),
          ])
        : [],
  };

  const invitations = new Map<
    string,
    {
      id: string;
      hashedToken: string;
      email: string;
      name: string | null;
      invitedByUserId: string;
      expiresAt: Date;
      acceptedAt: Date | null;
      revokedAt: Date | null;
    }
  >();
  const invitationRepository: InvitationRepository = {
    create: async (input) => {
      invitations.set(input.hashedToken, {
        id: input.id,
        hashedToken: input.hashedToken,
        email: input.email,
        name: input.name,
        invitedByUserId: input.invitedByUserId,
        expiresAt: input.expiresAt,
        acceptedAt: null,
        revokedAt: null,
      });
    },
    findActiveByHashedToken: async (hashedToken, now) => {
      const record = invitations.get(hashedToken);
      if (!record) return null;
      if (record.acceptedAt || record.revokedAt) return null;
      if (record.expiresAt.getTime() <= now.getTime()) return null;
      return {
        id: record.id,
        email: record.email,
        name: record.name,
      };
    },
    findById: async ({ id }) => {
      for (const invitation of invitations.values()) {
        if (invitation.id === id) {
          return {
            id: invitation.id,
            email: invitation.email,
            name: invitation.name,
          };
        }
      }
      return null;
    },
    listRecent: async ({ limit }) =>
      [...invitations.values()]
        .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())
        .slice(0, limit)
        .map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          name: invitation.name,
          expiresAt: invitation.expiresAt,
          acceptedAt: invitation.acceptedAt,
          revokedAt: invitation.revokedAt,
          createdAt: new Date(invitation.expiresAt.getTime() - 1000),
        })),
    revokeActiveByEmail: async (email, now) => {
      for (const invitation of invitations.values()) {
        if (
          invitation.email === email &&
          invitation.acceptedAt == null &&
          invitation.revokedAt == null &&
          invitation.expiresAt.getTime() > now.getTime()
        ) {
          invitation.revokedAt = now;
        }
      }
    },
    markAccepted: async (id, acceptedAt) => {
      for (const invitation of invitations.values()) {
        if (invitation.id === id) {
          invitation.acceptedAt = acceptedAt;
        }
      }
    },
    deleteExpired: async (now) => {
      for (const [hashedToken, invitation] of invitations.entries()) {
        if (invitation.expiresAt.getTime() <= now.getTime()) {
          invitations.delete(hashedToken);
        }
      }
    },
  };

  const defaultAvatarStorage: ContentStorage = {
    ensureBucketExists: async () => {},
    upload: async () => {},
    delete: async () => {},
    getPresignedDownloadUrl: async () => "https://example.com/avatar-presigned",
  };
  const avatarStorage = opts?.avatarStorage ?? defaultAvatarStorage;
  const sessions = new Map<string, { userId: string; expiresAt: Date }>();
  const revoked = new Set<string>();
  const authSessionRepository: AuthSessionRepository = {
    create: async ({ id, userId, expiresAt }) => {
      sessions.set(id, { userId, expiresAt });
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
        if (session.userId === userId) {
          revoked.add(id);
        }
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
  };

  const authRouter = createAuthRouter(
    createAuthHttpModule({
      credentialsRepository,
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
      trustProxyHeaders: true,
      passwordResetTokenRepository: {
        store: async () => {},
        findByHashedToken: async () => null,
        consumeByHashedToken: async () => {},
        deleteExpired: async () => {},
      },
      invitationRepository,
      invitationEmailSender: opts?.invitationEmailSender ?? {
        sendInvite: async () => {},
      },
      includeDevelopmentInviteUrls: true,
      inviteTokenTtlSeconds: 3600,
      inviteAcceptBaseUrl: "http://localhost:3000/accept-invite",
      avatarStorage,
      avatarUrlExpiresInSeconds: 3600,
    }),
  );

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
  return { app, nowSeconds };
};

describe("Auth routes", () => {
  const issueToken = async (): Promise<string> => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const sessionId = crypto.randomUUID();
    return sign(
      {
        sub: "user-1",
        username: "test1",
        email: "test1@example.com",
        iat: nowSeconds,
        exp: nowSeconds + 3600,
        sid: sessionId,
        jti: sessionId,
        iss: "wildfire",
      },
      "test-secret",
    );
  };

  test("POST /auth/login returns token for valid credentials", async () => {
    const { app, nowSeconds } = buildApp();

    const response = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "test1",
        password: "xc4uuicX",
      }),
    });

    expect(response.status).toBe(200);
    const body =
      await parseJson<
        ApiData<{
          type: "bearer";
          token: string;
          expiresAt: string;
          user: {
            id: string;
            username: string;
            email: string | null;
            name: string;
            timezone: string | null;
            isRoot: boolean;
          };
          permissions: string[];
        }>
      >(response);

    expect(body.data).toMatchObject({
      type: "bearer",
      expiresAt: new Date(
        nowSeconds * 1000 + tokenTtlSeconds * 1000,
      ).toISOString(),
      user: {
        id: "user-1",
        username: "test1",
        email: "test1@example.com",
        name: "Test One",
        timezone: null,
        isRoot: false,
      },
      permissions: ["roles:read", "roles:create"],
    });
    expect(typeof body.data.token).toBe("string");
  });

  test("POST /auth/login returns 401 for invalid credentials", async () => {
    const { app } = buildApp();

    const response = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "test1",
        password: "wrong",
      }),
    });

    expect(response.status).toBe(401);
    const body = await parseJson<{
      error: { code: string; message: string; requestId: string };
    }>(response);

    expect(body).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "invalid_credentials",
          message: "Invalid credentials",
        }),
      }),
    );
  });

  test("POST /auth/login returns 401 with deactivated message when user is inactive", async () => {
    const { app } = buildApp({ inactiveUsername: "test1" });

    const response = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "test1",
        password: "xc4uuicX",
      }),
    });

    expect(response.status).toBe(401);
    const body = await parseJson<{
      error: { code: string; message: string; requestId: string };
    }>(response);

    expect(body).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "invalid_credentials",
          message: DEACTIVATED_MESSAGE,
        }),
      }),
    );
  });

  test("POST /auth/session/refresh returns refreshed token when authorized", async () => {
    const { app, nowSeconds } = buildApp();

    const loginResponse = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "test1",
        password: "xc4uuicX",
      }),
    });

    const loginBody =
      await parseJson<ApiData<{ token: string }>>(loginResponse);
    const token = loginBody.data.token;

    const response = await app.request("/auth/session/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body =
      await parseJson<
        ApiData<{
          type: "bearer";
          token: string;
          expiresAt: string;
          user: {
            id: string;
            username: string;
            email: string | null;
            name: string;
            timezone: string | null;
            isRoot: boolean;
          };
          permissions: string[];
        }>
      >(response);

    expect(body.data).toMatchObject({
      type: "bearer",
      expiresAt: new Date(
        nowSeconds * 1000 + tokenTtlSeconds * 1000,
      ).toISOString(),
      user: {
        id: "user-1",
        username: "test1",
        email: "test1@example.com",
        name: "Test One",
        timezone: null,
        isRoot: false,
      },
      permissions: ["roles:read", "roles:create"],
    });
    expect(typeof body.data.token).toBe("string");
  });

  test("POST /auth/session/refresh returns 401 for invalid token payload", async () => {
    const { app } = buildApp();
    const token = await sign({ sub: 123 }, "test-secret");

    const response = await app.request("/auth/session/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
  });

  test("POST /auth/session/refresh returns 401 without token", async () => {
    const { app } = buildApp();

    const response = await app.request("/auth/session/refresh", {
      method: "POST",
    });

    expect(response.status).toBe(401);
  });

  test("POST /auth/logout returns 204", async () => {
    const { app } = buildApp();

    const loginResponse = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "test1",
        password: "xc4uuicX",
      }),
    });

    const { data } = await parseJson<ApiData<{ token: string }>>(loginResponse);
    const { token } = data;

    const response = await app.request("/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(204);
  });

  test("PATCH /auth/profile updates profile and returns refreshed payload", async () => {
    const { app } = buildApp();
    const token = await issueToken();

    const response = await app.request("/auth/profile", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Name",
        timezone: "Asia/Taipei",
      }),
    });

    expect(response.status).toBe(200);
    const body =
      await parseJson<
        ApiData<{
          user: {
            name: string;
            timezone: string | null;
          };
        }>
      >(response);
    expect(body.data.user.name).toBe("Updated Name");
    expect(body.data.user.timezone).toBe("Asia/Taipei");
  });

  test("POST /auth/password/change returns 204 when current password is valid", async () => {
    const hasher = new BcryptPasswordHasher();
    let passwordHash = await hasher.hash("old-password");
    const { app } = buildApp({
      credentialsRepository: {
        findPasswordHash: async () => passwordHash,
        updatePasswordHash: async (_username, nextHash) => {
          passwordHash = nextHash;
        },
      },
    });
    const token = await issueToken();

    const response = await app.request("/auth/password/change", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        currentPassword: "old-password",
        newPassword: "new-password-123",
      }),
    });

    expect(response.status).toBe(204);
  });

  test("PUT /auth/me/avatar uploads avatar and returns refreshed payload", async () => {
    const uploads: string[] = [];
    const avatarStorage: ContentStorage = {
      ensureBucketExists: async () => {},
      upload: async ({ key }) => {
        uploads.push(key);
      },
      delete: async () => {},
      getPresignedDownloadUrl: async ({ key }) =>
        `https://example.com/download/${key}`,
    };

    const { app } = buildApp({ avatarStorage });
    const token = await issueToken();
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", {
        type: "image/png",
      }),
    );

    const response = await app.request("/auth/me/avatar", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    expect(response.status).toBe(200);
    expect(uploads).toEqual(["avatars/user-1"]);
  });

  test("DELETE /auth/profile deletes current user", async () => {
    const { app } = buildApp();
    const token = await issueToken();

    const response = await app.request("/auth/profile", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(204);
  });

  test("POST /auth/invitations requires users:create permission", async () => {
    const { app } = buildApp();
    const token = await issueToken();

    const response = await app.request("/auth/invitations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "invited@example.com" }),
    });

    expect(response.status).toBe(403);
  });

  test("POST /auth/invitations returns 201 with metadata", async () => {
    let inviteUrl: string | undefined;
    const { app } = buildApp({
      permissions: [new Permission("users", "create")],
      invitationEmailSender: {
        sendInvite: async (input) => {
          inviteUrl = input.inviteUrl;
        },
      },
    });
    const token = await issueToken();

    const response = await app.request("/auth/invitations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "invited@example.com",
        name: "Invited User",
      }),
    });

    expect(response.status).toBe(201);
    const body =
      await parseJson<
        ApiData<{
          id: string;
          expiresAt: string;
          inviteUrl?: string;
        }>
      >(response);
    expect(body.data.id).toEqual(expect.any(String));
    expect(body.data.expiresAt).toEqual(expect.any(String));
    expect(inviteUrl).toContain("token=");
  });

  test("GET /auth/invitations returns invitation statuses", async () => {
    const { app } = buildApp({
      permissions: [new Permission("users", "create")],
    });
    const token = await issueToken();

    const createResponse = await app.request("/auth/invitations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "list.invite@example.com" }),
    });
    expect(createResponse.status).toBe(201);

    const response = await app.request("/auth/invitations", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      data: {
        id: string;
        email: string;
        status: string;
        expiresAt: string;
      }[];
      meta: {
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      };
    }>(response);
    expect(
      body.data.some((item) => item.email === "list.invite@example.com"),
    ).toBe(true);
    const listed = body.data.find(
      (item) => item.email === "list.invite@example.com",
    );
    expect(listed?.status).toBe("pending");
    expect(listed?.expiresAt).toEqual(expect.any(String));
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
  });

  test("POST /auth/invitations/:id/resend creates new invite", async () => {
    const inviteUrls: string[] = [];
    const { app } = buildApp({
      permissions: [new Permission("users", "create")],
      invitationEmailSender: {
        sendInvite: async (input) => {
          inviteUrls.push(input.inviteUrl);
        },
      },
    });
    const token = await issueToken();

    const createResponse = await app.request("/auth/invitations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "resend.invite@example.com" }),
    });
    const created = await parseJson<ApiData<{ id: string }>>(createResponse);

    const resendResponse = await app.request(
      `/auth/invitations/${created.data.id}/resend`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    expect(resendResponse.status).toBe(201);
    const resent = await parseJson<ApiData<{ id: string }>>(resendResponse);
    expect(resent.data.id).not.toBe(created.data.id);
    expect(inviteUrls).toHaveLength(2);
    expect(inviteUrls.at(-1)).toContain("token=");
  });

  test("POST /auth/invitations/accept accepts a valid invitation", async () => {
    const credentials = new Map<string, string>([["test1", "hash"]]);
    let inviteUrl: string | undefined;
    const credentialsRepository: CredentialsRepository = {
      findPasswordHash: async (username) => credentials.get(username) ?? null,
      updatePasswordHash: async (username, newPasswordHash) => {
        credentials.set(username, newPasswordHash);
      },
      createPasswordHash: async (username, passwordHash) => {
        credentials.set(username, passwordHash);
      },
    };

    const { app } = buildApp({
      credentialsRepository,
      permissions: [new Permission("users", "create")],
      invitationEmailSender: {
        sendInvite: async (input) => {
          inviteUrl = input.inviteUrl;
        },
      },
    });
    const token = await issueToken();
    const createResponse = await app.request("/auth/invitations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "new.invite@example.com" }),
    });
    expect(createResponse.status).toBe(201);
    expect(inviteUrl).toContain("token=");
    const parsedUrl = new URL(inviteUrl ?? "http://localhost/invalid");
    const inviteToken = parsedUrl.searchParams.get("token") ?? "";

    const acceptResponse = await app.request("/auth/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: inviteToken,
        username: "brandnew",
        password: "new-password-123",
        name: "Brand New User",
      }),
    });

    expect(acceptResponse.status).toBe(204);
    expect(credentials.get("brandnew")).toEqual(expect.any(String));
  });
});
