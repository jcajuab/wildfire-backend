import { describe, expect, test } from "bun:test";
import { CheckPermissionUseCase } from "#/application/use-cases/rbac";
import { Permission } from "#/domain/rbac/permission";

const makeUseCase = (permissions: string[], isAdmin = false) =>
  new CheckPermissionUseCase({
    authorizationRepository: {
      findPermissionsForUser: async () =>
        permissions.map((permission) => Permission.parse(permission)),
      isAdminUser: async () => isAdmin,
    },
  });

describe("CheckPermissionUseCase", () => {
  test("returns true when permission is granted", async () => {
    const useCase = makeUseCase(["content:read", "users:delete"]);

    const allowed = await useCase.execute({
      userId: "user-1",
      required: "users:delete",
    });

    expect(allowed).toBe(true);
  });

  test("returns true for admin users", async () => {
    const useCase = makeUseCase([], true);

    const allowed = await useCase.execute({
      userId: "user-1",
      required: "users:delete",
    });

    expect(allowed).toBe(true);
  });

  test("returns false when permission is missing", async () => {
    const useCase = makeUseCase(["content:read"]);

    const allowed = await useCase.execute({
      userId: "user-1",
      required: "content:delete",
    });

    expect(allowed).toBe(false);
  });
});
