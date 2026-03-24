import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/errors/not-found";
import { UpdateCurrentUserProfileUseCase } from "#/application/use-cases/auth/update-current-user-profile.use-case";

const baseUser = {
  id: "user-1",
  username: "alice",
  email: "alice@example.com",
  name: "Alice",
  isActive: true,
  invitedAt: "2024-01-01T00:00:00Z",
};

function makeUseCase(overrides: {
  findById?: () => Promise<typeof baseUser | null>;
  update?: (
    id: string,
    data: Record<string, unknown>,
  ) => Promise<typeof baseUser | null>;
  isAdminUser?: () => Promise<boolean>;
}) {
  return new UpdateCurrentUserProfileUseCase({
    userRepository: {
      findById: overrides.findById ?? (async () => baseUser),
      findByUsername: async () => null,
      findByEmail: async () => null,
      update:
        overrides.update ??
        (async (_id: string, data: Record<string, unknown>) => ({
          ...baseUser,
          ...data,
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

describe("UpdateCurrentUserProfileUseCase — username guard", () => {
  test("rejects username change (after normalization)", async () => {
    const useCase = makeUseCase({});

    await expect(
      useCase.execute({ userId: "user-1", username: "new-alice" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("rejects username change even with whitespace/case differences", async () => {
    const useCase = makeUseCase({});

    // "Alice " normalizes to "alice" which equals baseUser.username — should NOT throw
    // But " NEWALICE " normalizes to "newalice" which differs — should throw
    await expect(
      useCase.execute({ userId: "user-1", username: " NEWALICE " }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("allows update when username is same (case-normalized)", async () => {
    const useCase = makeUseCase({});

    const result = await useCase.execute({
      userId: "user-1",
      username: "alice",
    });
    expect(result.id).toBe("user-1");
  });

  test("allows update when username is omitted", async () => {
    const useCase = makeUseCase({});

    const result = await useCase.execute({
      userId: "user-1",
      name: "Alice Smith",
    });
    expect(result).toBeDefined();
  });

  test("throws NotFoundError when user does not exist", async () => {
    const useCase = makeUseCase({
      findById: async () => null,
      update: async () => null,
    });

    await expect(
      useCase.execute({ userId: "missing", name: "Name" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
