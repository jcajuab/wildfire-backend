import { describe, expect, test } from "bun:test";
import path from "node:path";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import { Permission } from "#/domain/rbac/permission";
import { BcryptPasswordVerifier } from "#/infrastructure/auth/bcrypt-password.verifier";
import { HtshadowCredentialsRepository } from "#/infrastructure/auth/htshadow.repo";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { createAuthRouter } from "#/interfaces/http/routes/auth.route";

const fixturePath = path.join(
  import.meta.dir,
  "../../fixtures/example_htshadow",
);
const tokenTtlSeconds = 60 * 60;
const parseJson = async <T>(response: Response) => (await response.json()) as T;

const DEACTIVATED_MESSAGE =
  "Your account is currently deactivated. Please contact your administrator.";

const buildApp = (opts?: { inactiveUserEmail?: string }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const inactiveUserEmail = opts?.inactiveUserEmail;
  const credentialsRepository = new HtshadowCredentialsRepository({
    filePath: fixturePath,
  });
  const passwordVerifier = new BcryptPasswordVerifier();
  const tokenIssuer = new JwtTokenIssuer({ secret: "test-secret" });
  const clock = { nowSeconds: () => nowSeconds };
  const userRepository: UserRepository = {
    list: async () => [],
    findByEmail: async (email: string) =>
      email === "test1@example.com"
        ? {
            id: "user-1",
            email,
            name: "Test One",
            isActive: email !== inactiveUserEmail,
          }
        : null,
    findById: async (id: string) =>
      id === "user-1"
        ? {
            id: "user-1",
            email: "test1@example.com",
            name: "Test One",
            isActive: inactiveUserEmail !== "test1@example.com",
          }
        : null,
    findByIds: async () => [],
    create: async ({ email, name, isActive }) => ({
      id: "user-1",
      email,
      name,
      isActive: isActive ?? true,
    }),
    update: async () => null,
    delete: async () => false,
  };

  const authorizationRepository: AuthorizationRepository = {
    findPermissionsForUser: async (userId: string) =>
      userId === "user-1"
        ? [new Permission("roles", "read"), new Permission("roles", "create")]
        : [],
  };

  const authRouter = createAuthRouter({
    credentialsRepository,
    passwordVerifier,
    tokenIssuer,
    clock,
    tokenTtlSeconds,
    userRepository,
    authorizationRepository,
    jwtSecret: "test-secret",
  });

  const app = new Hono();
  app.route("/auth", authRouter);
  return { app, nowSeconds };
};

describe("Auth routes", () => {
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
      user: { id: string; email: string; name: string };
      permissions: string[];
    }>(response);

    expect(body).toEqual({
      type: "bearer",
      token: expect.any(String),
      expiresAt: new Date(
        nowSeconds * 1000 + tokenTtlSeconds * 1000,
      ).toISOString(),
      user: { id: "user-1", email: "test1@example.com", name: "Test One" },
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
      user: { id: string; email: string; name: string };
      permissions: string[];
    }>(response);

    expect(body).toEqual({
      type: "bearer",
      token: expect.any(String),
      expiresAt: new Date(
        nowSeconds * 1000 + tokenTtlSeconds * 1000,
      ).toISOString(),
      user: { id: "user-1", email: "test1@example.com", name: "Test One" },
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
});
