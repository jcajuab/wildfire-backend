import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createCsrfMiddleware } from "#/interfaces/http/middleware/csrf";

const SESSION_COOKIE = "wildfire_session_token";
const CSRF_COOKIE = "wildfire_csrf";

describe("CSRF middleware", () => {
  const buildApp = () => {
    const app = new Hono();
    app.use("*", createCsrfMiddleware(SESSION_COOKIE, CSRF_COOKIE));
    app.post("/v1/auth/invitations/accept", (c) => c.json({ ok: true }));
    app.post("/v1/protected-mutation", (c) => c.json({ ok: true }));
    return app;
  };

  test("POST /v1/auth/invitations/accept skips CSRF even when session cookie is present", async () => {
    const app = buildApp();
    const res = await app.request("/v1/auth/invitations/accept", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${SESSION_COOKIE}=sess-value`,
      },
      body: JSON.stringify({
        token: "t",
        password: "password-12",
        username: "u",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("POST to non-exempt path returns 403 when session cookie present but CSRF tokens missing", async () => {
    const app = buildApp();
    const res = await app.request("/v1/protected-mutation", {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE}=sess-value`,
      },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("CSRF validation failed");
  });

  test("POST to non-exempt path succeeds when header matches CSRF cookie", async () => {
    const app = buildApp();
    const token = "same-token-value";
    const res = await app.request("/v1/protected-mutation", {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE}=sess; ${CSRF_COOKIE}=${token}`,
        "X-CSRF-Token": token,
      },
    });
    expect(res.status).toBe(200);
  });
});
