import { describe, expect, test } from "bun:test";
import { type UserRepository } from "#/application/ports/rbac";
import { UpdateCurrentUserProfileUseCase } from "#/application/use-cases/auth";
import { NotFoundError } from "#/application/use-cases/rbac/errors";

describe("UpdateCurrentUserProfileUseCase", () => {
  test("updates profile fields for existing user", async () => {
    const repo: UserRepository = {
      list: async () => [],
      findById: async () => ({
        id: "user-1",
        email: "test@example.com",
        name: "Before",
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
      update: async (_id, update) => ({
        id: "user-1",
        email: "test@example.com",
        name: update.name ?? "Before",
        timezone: update.timezone,
        isActive: true,
      }),
      delete: async () => false,
    };

    const useCase = new UpdateCurrentUserProfileUseCase({
      userRepository: repo,
    });
    const result = await useCase.execute({
      userId: "user-1",
      name: "After",
      timezone: "Asia/Taipei",
    });

    expect(result).toEqual({
      id: "user-1",
      email: "test@example.com",
      name: "After",
      timezone: "Asia/Taipei",
      isActive: true,
    });
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

    const useCase = new UpdateCurrentUserProfileUseCase({
      userRepository: repo,
    });
    await expect(
      useCase.execute({ userId: "missing", name: "Name" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
