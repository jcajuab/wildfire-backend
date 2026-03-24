import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/use-cases/rbac/errors";
import { UpdateRoleUseCase } from "#/application/use-cases/rbac/update-role.use-case";

describe("UpdateRoleUseCase", () => {
  test("rejects update when role is a system role (Admin)", async () => {
    const useCase = new UpdateRoleUseCase({
      roleRepository: {
        findById: async () => ({
          id: "role-admin",
          name: "Admin",
          description: null,
          isSystem: true,
        }),
        update: async () => null,
      } as never,
    });

    await expect(
      useCase.execute({ id: "role-admin", name: "Superadmin" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("allows update for non-system roles", async () => {
    const useCase = new UpdateRoleUseCase({
      roleRepository: {
        findById: async () => ({
          id: "role-editor",
          name: "Editor",
          description: null,
          isSystem: false,
        }),
        update: async (
          id: string,
          data: { name?: string; description?: string | null },
        ) => ({
          id,
          name: data.name ?? "Editor",
          description: data.description ?? null,
          isSystem: false,
        }),
      } as never,
    });

    const result = await useCase.execute({
      id: "role-editor",
      name: "Senior Editor",
    });
    expect(result.name).toBe("Senior Editor");
  });

  test("throws NotFoundError when role does not exist", async () => {
    const useCase = new UpdateRoleUseCase({
      roleRepository: {
        findById: async () => null,
        update: async () => null,
      } as never,
    });

    await expect(
      useCase.execute({ id: "nonexistent", name: "Whatever" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
