import { describe, expect, test } from "bun:test";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";

const decodePayload = (token: string) => {
  const [, payload] = token.split(".");
  if (!payload) {
    throw new Error("Invalid JWT format");
  }
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub: string;
    username: string;
    iat: number;
    exp: number;
    iss?: string;
    email?: string;
  };
};

describe("JwtTokenIssuer", () => {
  test("issues tokens with expected claims", async () => {
    const issuer = new JwtTokenIssuer({ secret: "test-secret" });
    const token = await issuer.issueToken({
      subject: "user-1",
      username: "user",
      issuedAt: 1_700_000_000,
      expiresAt: 1_700_003_600,
      issuer: "wildfire",
      email: "user@example.com",
    });

    const payload = decodePayload(token);
    expect(payload).toMatchObject({
      sub: "user-1",
      username: "user",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
      iss: "wildfire",
      email: "user@example.com",
    });
  });
});
