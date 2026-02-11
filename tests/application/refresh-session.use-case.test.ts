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
});
