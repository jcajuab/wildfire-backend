import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/errors/not-found";
import { BanUserUseCase } from "#/application/use-cases/users/ban-user.use-case";

const baseUser = {
  id: "user-2",
  username: "bob",
  email: "bob@example.com",
  name: "Bob",
  isActive: true,
};

function makeUseCase(overrides: {
  isAdminUser?: (id: string) => Promise<boolean>;
  findById?: (id: string) => Promise<typeof baseUser | null>;
}) {
  return new BanUserUseCase({
    userRepository: {
      findById: overrides.findById ?? (async () => baseUser),
      update: async () => null,
      list: async () => [],
      findByIds: async () => [],
      findByUsername: async () => null,
      findByEmail: async () => null,
      create: async () => baseUser,
      delete: async () => false,
    } as never,
    authSessionRepository: {
      revokeAllForUser: async () => {},
    } as never,
    authorizationRepository: {
      isAdminUser: overrides.isAdminUser ?? (async () => true),
      findPermissionsForUser: async () => [],
    } as never,
  });
}

describe("BanUserUseCase — self-ban guard", () => {
  test("rejects self-ban", async () => {
    const useCase = makeUseCase({});

    await expect(
      useCase.execute({ id: "admin-1", callerUserId: "admin-1" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("allows banning another user", async () => {
    let banned = false;
    const useCase = new BanUserUseCase({
      userRepository: {
        findById: async () => baseUser,
        update: async () => {
          banned = true;
          return null;
        },
        list: async () => [],
        findByIds: async () => [],
        findByUsername: async () => null,
        findByEmail: async () => null,
        create: async () => baseUser,
        delete: async () => false,
      } as never,
      authSessionRepository: {
        revokeAllForUser: async () => {},
      } as never,
      authorizationRepository: {
        isAdminUser: async () => true,
        findPermissionsForUser: async () => [],
      } as never,
    });

    await useCase.execute({ id: "user-2", callerUserId: "admin-1" });
    expect(banned).toBe(true);
  });

  test("rejects when caller is not admin", async () => {
    const useCase = makeUseCase({
      isAdminUser: async () => false,
    });

    await expect(
      useCase.execute({ id: "user-2", callerUserId: "user-1" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("throws NotFoundError when target user does not exist", async () => {
    const useCase = makeUseCase({
      findById: async () => null,
    });

    await expect(
      useCase.execute({ id: "missing", callerUserId: "admin-1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
