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
import {
  ChangeCurrentUserPasswordUseCase,
  SetCurrentUserAvatarUseCase,
  UpdateCurrentUserProfileUseCase,
} from "#/application/use-cases/auth";
import { DeleteCurrentUserUseCase } from "#/application/use-cases/rbac";
import { Permission } from "#/domain/rbac/permission";
import { BcryptPasswordHasher } from "#/infrastructure/auth/bcrypt-password.hasher";
import { BcryptPasswordVerifier } from "#/infrastructure/auth/bcrypt-password.verifier";
import { HtshadowCredentialsRepository } from "#/infrastructure/auth/htshadow.repo";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createAuthRouter } from "#/interfaces/http/routes/auth.route";
import { InMemoryAuthSecurityStore } from "#/interfaces/http/security/in-memory-auth-security.store";

const fixturePath = path.join(
  import.meta.dir,
  "../../fixtures/example_htshadow",
);
const tokenTtlSeconds = 60 * 60;
const parseJson = async <T>(response: Response) => (await response.json()) as T;

const DEACTIVATED_MESSAGE =
  "Your account is currently deactivated. Please contact your administrator.";

const buildApp = (opts?: {
  inactiveUserEmail?: string;
  avatarStorage?: ContentStorage;
  credentialsRepository?: CredentialsRepository;
  permissions?: Permission[];
}) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const inactiveUserEmail = opts?.inactiveUserEmail;
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
    email: string;
    name: string;
    isActive: boolean;
    timezone: string | null;
    avatarKey: string | null;
  } | null = {
    id: "user-1",
    email: "test1@example.com",
    name: "Test One",
    isActive: inactiveUserEmail !== "test1@example.com",
    timezone: null,
    avatarKey: null,
  };
  const invitedUsers = new Map<
    string,
    {
      id: string;
      email: string;
      name: string;
      isActive: boolean;
      timezone: string | null;
      avatarKey: string | null;
    }
  >();

  const userRepository: UserRepository = {
    list: async () => [],
    findByEmail: async (email: string) =>
      currentUser != null && email === currentUser.email
        ? { ...currentUser }
        : (invitedUsers.get(email) ?? null),
    findById: async (id: string) =>
      currentUser != null && id === currentUser.id
        ? { ...currentUser }
        : ([...invitedUsers.values()].find((user) => user.id === id) ?? null),
    findByIds: async () => [],
    create: async ({ email, name, isActive }) => {
      const user = {
        id: `user-${invitedUsers.size + 2}`,
        email,
        name,
        isActive: isActive ?? true,
        timezone: null,
        avatarKey: null,
      };
      invitedUsers.set(email, user);
      return user;
    },
    update: async (id, input) => {
      if (currentUser == null || id !== currentUser.id) {
        return null;
      }
      currentUser = {
        ...currentUser,
        email: input.email ?? currentUser.email,
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
        for (const [email, user] of invitedUsers.entries()) {
          if (user.id === id) {
            invitedUsers.delete(email);
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
      if (!session) return false;
      if (revoked.has(sessionId)) return false;
      return session.expiresAt.getTime() > now.getTime();
    },
  };

  const authRouter = createAuthRouter({
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
    authSessionDualMode: true,
    authSecurityStore: new InMemoryAuthSecurityStore(),
    authLoginRateLimitMaxAttempts: 20,
    authLoginRateLimitWindowSeconds: 60,
    authLoginLockoutThreshold: 10,
    authLoginLockoutSeconds: 60,
    passwordResetTokenRepository: {
      store: async () => {},
      findByHashedToken: async () => null,
      consumeByHashedToken: async () => {},
      deleteExpired: async () => {},
    },
    invitationRepository,
    invitationEmailSender: {
      sendInvite: async () => {},
    },
    inviteTokenTtlSeconds: 3600,
    inviteAcceptBaseUrl: "http://localhost:3000/accept-invite",
    deleteCurrentUserUseCase: new DeleteCurrentUserUseCase({ userRepository }),
    updateCurrentUserProfileUseCase: new UpdateCurrentUserProfileUseCase({
      userRepository,
    }),
    changeCurrentUserPasswordUseCase: new ChangeCurrentUserPasswordUseCase({
      userRepository,
      credentialsRepository,
      passwordVerifier,
      passwordHasher: new BcryptPasswordHasher(),
    }),
    setCurrentUserAvatarUseCase: new SetCurrentUserAvatarUseCase({
      userRepository,
      storage: avatarStorage,
    }),
    avatarStorage,
    avatarUrlExpiresInSeconds: 3600,
  });

  const app = new Hono();
  app.route("/auth", authRouter);
  return { app, nowSeconds };
};

describe("Auth routes", () => {
  const issueToken = async (): Promise<string> => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return sign(
      {
        sub: "user-1",
        email: "test1@example.com",
        iat: nowSeconds,
        exp: nowSeconds + 3600,
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
        email: "test1@example.com",
        password: "xc4uuicX",
      }),
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      type: "bearer";
      token: string;
      expiresAt: string;
      user: {
        id: string;
        email: string;
        name: string;
        timezone: string | null;
      };
      permissions: string[];
    }>(response);

    expect(body).toEqual({
      type: "bearer",
      token: expect.any(String),
      expiresAt: new Date(
        nowSeconds * 1000 + tokenTtlSeconds * 1000,
      ).toISOString(),
      user: {
        id: "user-1",
        email: "test1@example.com",
        name: "Test One",
        timezone: null,
      },
      permissions: ["roles:read", "roles:create"],
    });
  });

  test("POST /auth/login returns 401 for invalid credentials", async () => {
    const { app } = buildApp();

    const response = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test1@example.com",
        password: "wrong",
      }),
    });

    expect(response.status).toBe(401);
    const body = await parseJson<{ error: { code: string; message: string } }>(
      response,
    );

    expect(body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      },
    });
  });

  test("POST /auth/login returns 401 with deactivated message when user is inactive", async () => {
    const { app } = buildApp({ inactiveUserEmail: "test1@example.com" });

    const response = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test1@example.com",
        password: "xc4uuicX",
      }),
    });

    expect(response.status).toBe(401);
    const body = await parseJson<{ error: { code: string; message: string } }>(
      response,
    );

    expect(body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: DEACTIVATED_MESSAGE,
      },
    });
  });

  test("GET /auth/me returns refreshed token when authorized", async () => {
    const { app, nowSeconds } = buildApp();

    const loginResponse = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test1@example.com",
        password: "xc4uuicX",
      }),
    });

    const loginBody = await parseJson<{ token: string }>(loginResponse);
    const token = loginBody.token;

    const response = await app.request("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await parseJson<{
      type: "bearer";
      token: string;
      expiresAt: string;
      user: {
        id: string;
        email: string;
        name: string;
        timezone: string | null;
      };
      permissions: string[];
    }>(response);

    expect(body).toEqual({
      type: "bearer",
      token: expect.any(String),
      expiresAt: new Date(
        nowSeconds * 1000 + tokenTtlSeconds * 1000,
      ).toISOString(),
      user: {
        id: "user-1",
        email: "test1@example.com",
        name: "Test One",
        timezone: null,
      },
      permissions: ["roles:read", "roles:create"],
    });
  });

  test("GET /auth/me returns 401 for invalid token payload", async () => {
    const { app } = buildApp();
    const token = await sign({ sub: 123 }, "test-secret");

    const response = await app.request("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
  });

  test("GET /auth/me returns 401 without token", async () => {
    const { app } = buildApp();

    const response = await app.request("/auth/me");

    expect(response.status).toBe(401);
  });

  test("POST /auth/logout returns 204", async () => {
    const { app } = buildApp();

    const loginResponse = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test1@example.com",
        password: "xc4uuicX",
      }),
    });

    const { token } = await parseJson<{ token: string }>(loginResponse);

    const response = await app.request("/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(204);
  });

  test("PATCH /auth/me updates profile and returns refreshed payload", async () => {
    const { app } = buildApp();
    const token = await issueToken();

    const response = await app.request("/auth/me", {
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
    const body = await parseJson<{
      user: {
        name: string;
        timezone: string | null;
      };
    }>(response);
    expect(body.user.name).toBe("Updated Name");
    expect(body.user.timezone).toBe("Asia/Taipei");
  });

  test("POST /auth/me/password returns 204 when current password is valid", async () => {
    const hasher = new BcryptPasswordHasher();
    let passwordHash = await hasher.hash("old-password");
    const { app } = buildApp({
      credentialsRepository: {
        findPasswordHash: async () => passwordHash,
        updatePasswordHash: async (_email, nextHash) => {
          passwordHash = nextHash;
        },
      },
    });
    const token = await issueToken();

    const response = await app.request("/auth/me/password", {
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

  test("DELETE /auth/me deletes current user", async () => {
    const { app } = buildApp();
    const token = await issueToken();

    const response = await app.request("/auth/me", {
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
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const { app } = buildApp({
        permissions: [new Permission("users", "create")],
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
      const body = await parseJson<{
        id: string;
        expiresAt: string;
        inviteUrl?: string;
      }>(response);
      expect(body.id).toEqual(expect.any(String));
      expect(body.expiresAt).toEqual(expect.any(String));
      expect(body.inviteUrl).toContain("token=");
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  test("GET /auth/invitations returns invitation statuses", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
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
      const body =
        await parseJson<
          {
            id: string;
            email: string;
            status: string;
            expiresAt: string;
          }[]
        >(response);
      expect(
        body.some((item) => item.email === "list.invite@example.com"),
      ).toBe(true);
      const listed = body.find(
        (item) => item.email === "list.invite@example.com",
      );
      expect(listed?.status).toBe("pending");
      expect(listed?.expiresAt).toEqual(expect.any(String));
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  test("POST /auth/invitations/:id/resend creates new invite", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
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
        body: JSON.stringify({ email: "resend.invite@example.com" }),
      });
      const created = await parseJson<{ id: string }>(createResponse);

      const resendResponse = await app.request(
        `/auth/invitations/${created.id}/resend`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      expect(resendResponse.status).toBe(201);
      const resent = await parseJson<{ id: string; inviteUrl?: string }>(
        resendResponse,
      );
      expect(resent.id).not.toBe(created.id);
      expect(resent.inviteUrl).toContain("token=");
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  test("POST /auth/invitations/accept accepts a valid invitation", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const credentials = new Map<string, string>([
        ["test1@example.com", "hash"],
      ]);
      const credentialsRepository: CredentialsRepository = {
        findPasswordHash: async (username) => credentials.get(username) ?? null,
        updatePasswordHash: async (email, newPasswordHash) => {
          credentials.set(email, newPasswordHash);
        },
        createPasswordHash: async (email, passwordHash) => {
          credentials.set(email, passwordHash);
        },
      };

      const { app } = buildApp({
        credentialsRepository,
        permissions: [new Permission("users", "create")],
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
      const createBody = await parseJson<{ inviteUrl?: string }>(
        createResponse,
      );
      const inviteUrl = createBody.inviteUrl;
      expect(inviteUrl).toBeDefined();
      const parsedUrl = new URL(inviteUrl ?? "http://localhost/invalid");
      const inviteToken = parsedUrl.searchParams.get("token") ?? "";

      const acceptResponse = await app.request("/auth/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: inviteToken,
          password: "new-password-123",
          name: "Brand New User",
        }),
      });

      expect(acceptResponse.status).toBe(204);
      expect(credentials.get("new.invite@example.com")).toEqual(
        expect.any(String),
      );
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
