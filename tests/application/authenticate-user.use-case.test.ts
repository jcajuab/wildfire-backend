import { describe, expect, test } from "bun:test";
import { type UserRepository } from "#/application/ports/rbac";
import {
  AuthenticateUserUseCase,
  InvalidCredentialsError,
} from "#/application/use-cases/auth";

const tokenTtlSeconds = 60 * 60;

const makeDeps = () => {
  const issued: {
    subject?: string;
    issuedAt?: number;
    expiresAt?: number;
  } = {};

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
    findById: async () => null,
    findByIds: async () => [],
    findByUsername: async (username: string) =>
      username === "test1"
        ? {
            id: "user-1",
            username,
            email: "test1@example.com",
            name: "Test One",
            isActive: true,
          }
        : null,
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

  return {
    issued,
    deps: {
      dbCredentialsRepository: {
        findPasswordHash: async () => "hash",
        updatePasswordHash: async () => {},
        createPasswordHash: async () => {},
      },
      htshadowCredentialsRepository: {
        findPasswordHash: async () => "hash",
        updatePasswordHash: async () => {},
        createPasswordHash: async () => {},
      },
      passwordVerifier: {
        verify: async () => true,
      },
      tokenIssuer: {
        issueToken,
      },
      userRepository,
      authorizationRepository: {
        findPermissionsForUser: async () => [],
        isAdminUser: async () => false,
      },
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
      },
    },
  };
};

describe("AuthenticateUserUseCase", () => {
  test("returns token metadata for valid credentials", async () => {
    const { deps, issued } = makeDeps();
    const useCase = new AuthenticateUserUseCase(deps);

    const result = await useCase.execute({
      username: "test1",
      password: "xc4uuicX",
    });

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
        invitedAt: null,
      },
    });
    expect(issued).toEqual({
      subject: "user-1",
      issuedAt: 1_700_000_000,
      expiresAt: 1_700_000_000 + tokenTtlSeconds,
    });
  });

  test("throws InvalidCredentialsError when user is missing", async () => {
    const { deps } = makeDeps();
    const useCase = new AuthenticateUserUseCase({
      ...deps,
      dbCredentialsRepository: {
        findPasswordHash: async () => null,
        updatePasswordHash: async () => {},
        createPasswordHash: async () => {},
      },
      htshadowCredentialsRepository: {
        findPasswordHash: async () => null,
        updatePasswordHash: async () => {},
        createPasswordHash: async () => {},
      },
    });

    await expect(
      useCase.execute({ username: "missing", password: "pw" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test("throws InvalidCredentialsError when password is invalid", async () => {
    const { deps } = makeDeps();
    const useCase = new AuthenticateUserUseCase({
      ...deps,
      passwordVerifier: {
        verify: async () => false,
      },
    });

    await expect(
      useCase.execute({ username: "test1", password: "wrong" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test("throws InvalidCredentialsError with deactivated message when user is inactive", async () => {
    const { deps } = makeDeps();
    const useCase = new AuthenticateUserUseCase({
      ...deps,
      userRepository: {
        ...deps.userRepository,
        findByUsername: async () => ({
          id: "user-2",
          username: "test2",
          email: "test2@example.com",
          name: "Test Two",
          isActive: false,
        }),
      },
    });

    const err = await useCase
      .execute({ username: "test2", password: "pw" })
      .then(
        () => null as unknown as InvalidCredentialsError,
        (e: unknown) => e as InvalidCredentialsError,
      );
    expect(err).toBeInstanceOf(InvalidCredentialsError);
    expect(err?.message).toBe(
      "Your account is currently deactivated. Please contact your administrator.",
    );
  });
});
