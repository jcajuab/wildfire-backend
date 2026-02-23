import { describe, expect, test } from "bun:test";
import { type UserRepository } from "#/application/ports/rbac";
import { RefreshSessionUseCase } from "#/application/use-cases/auth";

const tokenTtlSeconds = 60 * 60;

describe("RefreshSessionUseCase", () => {
  test("issues a refreshed token with new exp", async () => {
    const issued: { subject?: string; issuedAt?: number; expiresAt?: number } =
      {};

    const issueToken = async ({
      subject,
      issuedAt,
      expiresAt,
    }: {
      subject: string;
      issuedAt: number;
      expiresAt: number;
    }) => {
      issued.subject = subject;
      issued.issuedAt = issuedAt;
      issued.expiresAt = expiresAt;
      return `${subject}:${issuedAt}:${expiresAt}`;
    };

    const userRepository: UserRepository = {
      list: async () => [],
      findById: async (id: string) =>
        id === "user-1"
          ? {
              id: "user-1",
              email: "test1@example.com",
              name: "Test One",
              isActive: true,
            }
          : null,
      findByIds: async () => [],
      findByEmail: async () => null,
      create: async ({ email, name, isActive }) => ({
        id: "user-1",
        email,
        name,
        isActive: isActive ?? true,
      }),
      update: async () => null,
      delete: async () => false,
    };

    const useCase = new RefreshSessionUseCase({
      tokenIssuer: {
        issueToken,
      },
      userRepository,
      clock: {
        nowSeconds: () => 1_700_000_000,
      },
      tokenTtlSeconds,
      authSessionRepository: {
        create: async () => {},
        extendExpiry: async () => {},
        revokeById: async () => {},
        revokeAllForUser: async () => {},
        isActive: async () => true,
      },
    });

    const result = await useCase.execute({ userId: "user-1" });

    expect(result).toEqual({
      type: "bearer",
      token: "user-1:1700000000:1700003600",
      expiresAt: new Date(
        1_700_000_000 * 1000 + tokenTtlSeconds * 1000,
      ).toISOString(),
      user: {
        id: "user-1",
        email: "test1@example.com",
        name: "Test One",
        timezone: null,
        avatarKey: null,
      },
    });
    expect(issued).toEqual({
      subject: "user-1",
      issuedAt: 1_700_000_000,
      expiresAt: 1_700_000_000 + tokenTtlSeconds,
    });
  });

  test("when currentSessionId is provided, extends session and issues token with same sessionId (sliding session)", async () => {
    const currentSessionId = "session-abc";
    const issued: {
      subject?: string;
      issuedAt?: number;
      expiresAt?: number;
      sessionId?: string;
    } = {};
    const extendExpiryCalls: Array<{ sessionId: string; expiresAt: Date }> = [];
    const createCalls: Array<{ id: string }> = [];
    let revokeByIdCalled = false;

    const issueToken = async (input: {
      subject: string;
      issuedAt: number;
      expiresAt: number;
      sessionId?: string;
    }) => {
      issued.subject = input.subject;
      issued.issuedAt = input.issuedAt;
      issued.expiresAt = input.expiresAt;
      issued.sessionId = input.sessionId;
      return `${input.subject}:${input.issuedAt}:${input.expiresAt}:${input.sessionId ?? ""}`;
    };

    const userRepository: UserRepository = {
      list: async () => [],
      findById: async (id: string) =>
        id === "user-1"
          ? {
              id: "user-1",
              email: "test1@example.com",
              name: "Test One",
              isActive: true,
            }
          : null,
      findByIds: async () => [],
      findByEmail: async () => null,
      create: async ({ email, name, isActive }) => ({
        id: "user-1",
        email,
        name,
        isActive: isActive ?? true,
      }),
      update: async () => null,
      delete: async () => false,
    };

    const useCase = new RefreshSessionUseCase({
      tokenIssuer: { issueToken },
      userRepository,
      clock: { nowSeconds: () => 1_700_000_000 },
      tokenTtlSeconds,
      authSessionRepository: {
        create: async (input) => {
          createCalls.push({ id: input.id });
        },
        extendExpiry: async (sessionId, expiresAt) => {
          extendExpiryCalls.push({ sessionId, expiresAt });
        },
        revokeById: async () => {
          revokeByIdCalled = true;
        },
        revokeAllForUser: async () => {},
        isActive: async () => true,
      },
    });

    const result = await useCase.execute({
      userId: "user-1",
      currentSessionId,
    });

    expect(extendExpiryCalls).toHaveLength(1);
    expect(extendExpiryCalls[0]).toEqual({
      sessionId: currentSessionId,
      expiresAt: new Date((1_700_000_000 + tokenTtlSeconds) * 1000),
    });
    expect(createCalls).toHaveLength(0);
    expect(revokeByIdCalled).toBe(false);
    expect(issued.sessionId).toBe(currentSessionId);
    expect(result.token).toContain(currentSessionId);
  });
});
