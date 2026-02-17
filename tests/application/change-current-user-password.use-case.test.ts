import { describe, expect, test } from "bun:test";
import { type UserRepository } from "#/application/ports/rbac";
import {
  ChangeCurrentUserPasswordUseCase,
  InvalidCredentialsError,
} from "#/application/use-cases/auth";
import { NotFoundError } from "#/application/use-cases/rbac/errors";

describe("ChangeCurrentUserPasswordUseCase", () => {
  test("verifies current password and updates hash", async () => {
    let updatedEmail: string | undefined;
    let updatedHash: string | undefined;
    const repo: UserRepository = {
      list: async () => [],
      findById: async () => ({
        id: "user-1",
        email: "test@example.com",
        name: "Test",
        isActive: true,
      }),
      findByIds: async () => [],
      findByEmail: async () => null,
      create: async ({ email, name, isActive }) => ({
        id: "created",
        email,
        name,
        isActive: isActive ?? true,
      }),
      update: async () => null,
      delete: async () => false,
    };

    const useCase = new ChangeCurrentUserPasswordUseCase({
      userRepository: repo,
      credentialsRepository: {
        findPasswordHash: async () => "old-hash",
        updatePasswordHash: async (email, passwordHash) => {
          updatedEmail = email;
          updatedHash = passwordHash;
        },
      },
      passwordVerifier: {
        verify: async () => true,
      },
      passwordHasher: {
        hash: async () => "new-hash",
      },
    });

    await useCase.execute({
      userId: "user-1",
      currentPassword: "old-password",
      newPassword: "new-password",
    });

    expect(updatedEmail).toBe("test@example.com");
    expect(updatedHash).toBe("new-hash");
  });

  test("throws InvalidCredentialsError when current password is incorrect", async () => {
    const repo: UserRepository = {
      list: async () => [],
      findById: async () => ({
        id: "user-1",
        email: "test@example.com",
        name: "Test",
        isActive: true,
      }),
      findByIds: async () => [],
      findByEmail: async () => null,
      create: async ({ email, name, isActive }) => ({
        id: "created",
        email,
        name,
        isActive: isActive ?? true,
      }),
      update: async () => null,
      delete: async () => false,
    };

    const useCase = new ChangeCurrentUserPasswordUseCase({
      userRepository: repo,
      credentialsRepository: {
        findPasswordHash: async () => "old-hash",
        updatePasswordHash: async () => {},
      },
      passwordVerifier: {
        verify: async () => false,
      },
      passwordHasher: {
        hash: async () => "new-hash",
      },
    });

    await expect(
      useCase.execute({
        userId: "user-1",
        currentPassword: "wrong-password",
        newPassword: "new-password",
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test("throws NotFoundError when user does not exist", async () => {
    const repo: UserRepository = {
      list: async () => [],
      findById: async () => null,
      findByIds: async () => [],
      findByEmail: async () => null,
      create: async ({ email, name, isActive }) => ({
        id: "created",
        email,
        name,
        isActive: isActive ?? true,
      }),
      update: async () => null,
      delete: async () => false,
    };

    const useCase = new ChangeCurrentUserPasswordUseCase({
      userRepository: repo,
      credentialsRepository: {
        findPasswordHash: async () => "old-hash",
        updatePasswordHash: async () => {},
      },
      passwordVerifier: {
        verify: async () => true,
      },
      passwordHasher: {
        hash: async () => "new-hash",
      },
    });

    await expect(
      useCase.execute({
        userId: "missing",
        currentPassword: "old-password",
        newPassword: "new-password",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
