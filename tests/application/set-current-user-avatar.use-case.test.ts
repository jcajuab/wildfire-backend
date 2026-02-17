import { describe, expect, test } from "bun:test";
import { type UserRepository } from "#/application/ports/rbac";
import { SetCurrentUserAvatarUseCase } from "#/application/use-cases/auth";
import { NotFoundError } from "#/application/use-cases/rbac/errors";

describe("SetCurrentUserAvatarUseCase", () => {
  test("replaces existing avatar and stores new one", async () => {
    const deletedKeys: string[] = [];
    const uploadedKeys: string[] = [];
    const updatedUsers: string[] = [];

    const repo: UserRepository = {
      list: async () => [],
      findById: async () => ({
        id: "user-1",
        email: "test@example.com",
        name: "Test",
        isActive: true,
        avatarKey: "avatars/old",
      }),
      findByIds: async () => [],
      findByEmail: async () => null,
      create: async ({ email, name, isActive }) => ({
        id: "created",
        email,
        name,
        isActive: isActive ?? true,
      }),
      update: async (id, update) => {
        updatedUsers.push(`${id}:${update.avatarKey ?? ""}`);
        return {
          id,
          email: "test@example.com",
          name: "Test",
          isActive: true,
          avatarKey: update.avatarKey ?? null,
        };
      },
      delete: async () => false,
    };

    const useCase = new SetCurrentUserAvatarUseCase({
      userRepository: repo,
      storage: {
        upload: async ({ key }) => {
          uploadedKeys.push(key);
        },
        delete: async (key) => {
          deletedKeys.push(key);
        },
        getPresignedDownloadUrl: async () => "https://example.com/avatar",
      },
    });

    const result = await useCase.execute({
      userId: "user-1",
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      contentLength: 3,
    });

    expect(result.avatarKey).toBe("avatars/user-1");
    expect(deletedKeys).toEqual(["avatars/old"]);
    expect(uploadedKeys).toEqual(["avatars/user-1"]);
    expect(updatedUsers).toEqual(["user-1:avatars/user-1"]);
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

    const useCase = new SetCurrentUserAvatarUseCase({
      userRepository: repo,
      storage: {
        upload: async () => {},
        delete: async () => {},
        getPresignedDownloadUrl: async () => "https://example.com/avatar",
      },
    });

    await expect(
      useCase.execute({
        userId: "missing",
        body: new Uint8Array([1, 2, 3]),
        contentType: "image/png",
        contentLength: 3,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
