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
              username: "test1",
              email: "test1@example.com",
              name: "Test One",
              isActive: true,
            }
          : null,
      findByIds: async () => [],
      findByUsername: async () => null,
      findByEmail: async () => null,
      create: async ({ username, email, name, isActive }) => ({
        id: "user-1",
        username,
        email: email ?? null,
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
        isOwnedByUser: async () => true,
        findBySessionId: async (sessionId: string) => ({
          id: sessionId,
          userId: "user-1",
          familyId: "family-1",
          currentJti: "jti-current",
          previousJti: null,
          previousJtiExpiresAt: null,
          expiresAt: new Date(Date.now() + 3600 * 1000),
        }),
        updateCurrentJtiOptimistic: async () => false,
        revokeByFamilyId: async () => 0,
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
        username: "test1",
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

  test("when currentSessionId is provided, rotates jti and issues token with same sessionId (sliding session)", async () => {
    const currentSessionId = "session-abc";
    const existingJti = "jti-old-111";
    const issued: {
      subject?: string;
      issuedAt?: number;
      expiresAt?: number;
      sessionId?: string;
      jti?: string;
    } = {};
    const updateCalls: Array<{
      sessionId: string;
      expectedCurrentJti: string;
    }> = [];
    const createCalls: Array<{ id: string }> = [];
    let revokeByIdCalled = false;

    const issueToken = async (input: {
      subject: string;
      issuedAt: number;
      expiresAt: number;
      sessionId?: string;
      jti?: string;
    }) => {
      issued.subject = input.subject;
      issued.issuedAt = input.issuedAt;
      issued.expiresAt = input.expiresAt;
      issued.sessionId = input.sessionId;
      issued.jti = input.jti;
      return `${input.subject}:${input.issuedAt}:${input.expiresAt}:${input.sessionId ?? ""}`;
    };

    const userRepository: UserRepository = {
      list: async () => [],
      findById: async (id: string) =>
        id === "user-1"
          ? {
              id: "user-1",
              username: "test1",
              email: "test1@example.com",
              name: "Test One",
              isActive: true,
            }
          : null,
      findByIds: async () => [],
      findByUsername: async () => null,
      findByEmail: async () => null,
      create: async ({ username, email, name, isActive }) => ({
        id: "user-1",
        username,
        email: email ?? null,
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
        extendExpiry: async () => {},
        revokeById: async () => {
          revokeByIdCalled = true;
        },
        revokeAllForUser: async () => {},
        isActive: async () => true,
        isOwnedByUser: async () => true,
        findBySessionId: async (sessionId: string) =>
          sessionId === currentSessionId
            ? {
                id: currentSessionId,
                userId: "user-1",
                familyId: "family-1",
                currentJti: existingJti,
                previousJti: null,
                previousJtiExpiresAt: null,
                expiresAt: new Date((1_700_000_000 + tokenTtlSeconds) * 1000),
              }
            : null,
        updateCurrentJtiOptimistic: async (input) => {
          updateCalls.push({
            sessionId: input.sessionId,
            expectedCurrentJti: input.expectedCurrentJti,
          });
          return true;
        },
        revokeByFamilyId: async () => 0,
      },
    });

    const result = await useCase.execute({
      userId: "user-1",
      currentSessionId,
      currentJti: existingJti,
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual({
      sessionId: currentSessionId,
      expectedCurrentJti: existingJti,
    });
    expect(createCalls).toHaveLength(0);
    expect(revokeByIdCalled).toBe(false);
    expect(issued.sessionId).toBe(currentSessionId);
    expect(issued.jti).not.toBe(existingJti);
    expect(result.token).toContain(currentSessionId);
  });
});
