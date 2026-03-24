import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/use-cases/rbac/errors";
import { UpdateUserUseCase } from "#/application/use-cases/rbac/update-user.use-case";

const baseUser = {
  id: "user-1",
  username: "alice",
  email: "alice@example.com",
  name: "Alice",
  isActive: true,
  invitedAt: "2024-01-01T00:00:00Z",
};

function makeUseCase(overrides: {
  isAdminUser?: (id: string) => Promise<boolean>;
  findById?: () => Promise<typeof baseUser | null>;
  findByUsername?: () => Promise<typeof baseUser | null>;
  update?: (
    id: string,
    data: Record<string, unknown>,
  ) => Promise<typeof baseUser | null>;
}) {
  return new UpdateUserUseCase({
    userRepository: {
      findById: overrides.findById ?? (async () => baseUser),
      findByUsername: overrides.findByUsername ?? (async () => null),
      findByEmail: async () => null,
      update:
        overrides.update ??
        (async (id: string, data: Record<string, unknown>) => ({
          ...baseUser,
          ...data,
          id,
        })),
      list: async () => [],
      findByIds: async () => [],
      create: async () => baseUser,
      delete: async () => false,
    } as never,
    authorizationRepository: {
      isAdminUser: overrides.isAdminUser ?? (async () => false),
      findPermissionsForUser: async () => [],
    } as never,
  });
}

describe("UpdateUserUseCase — self-username guard", () => {
  test("rejects self-username change", async () => {
    const useCase = makeUseCase({});

    await expect(
      useCase.execute({
        id: "user-1",
        callerUserId: "user-1",
        username: "new-alice",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("allows self-update with same username", async () => {
    const useCase = makeUseCase({});

    const result = await useCase.execute({
      id: "user-1",
      callerUserId: "user-1",
      username: "alice",
    });
    expect(result.id).toBe("user-1");
  });

  test("allows admin to change another user's username", async () => {
    const useCase = makeUseCase({});

    const result = await useCase.execute({
      id: "user-1",
      callerUserId: "admin-99",
      username: "new-alice",
    });
    expect(result).toBeDefined();
  });
});

describe("UpdateUserUseCase — self-deactivation guard", () => {
  test("rejects admin self-deactivation", async () => {
    const useCase = makeUseCase({
      isAdminUser: async () => true,
    });

    await expect(
      useCase.execute({
        id: "user-1",
        callerUserId: "user-1",
        isActive: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("allows admin to deactivate another user", async () => {
    const useCase = makeUseCase({
      // target user-1 is admin, caller admin-99 is also admin
      isAdminUser: async (id) => id === "user-1" || id === "admin-99",
    });

    const result = await useCase.execute({
      id: "user-1",
      callerUserId: "admin-99",
      isActive: false,
    });
    expect(result).toBeDefined();
  });

  test("allows non-admin self-deactivation", async () => {
    const useCase = makeUseCase({
      isAdminUser: async () => false,
    });

    const result = await useCase.execute({
      id: "user-1",
      callerUserId: "user-1",
      isActive: false,
    });
    expect(result).toBeDefined();
  });
});

describe("UpdateUserUseCase — not found", () => {
  test("throws NotFoundError when user does not exist", async () => {
    const useCase = makeUseCase({
      findById: async () => null,
      update: async () => null,
    });

    await expect(useCase.execute({ id: "missing" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
