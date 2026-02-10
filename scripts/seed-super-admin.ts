import { SeedSuperAdminRoleUseCase } from "#/application/use-cases/rbac";
import { closeDbConnection } from "#/infrastructure/db/client";
import { PermissionDbRepository } from "#/infrastructure/db/repositories/permission.repo";
import { RoleDbRepository } from "#/infrastructure/db/repositories/role.repo";
import { RolePermissionDbRepository } from "#/infrastructure/db/repositories/role-permission.repo";
import "#/env";

async function main(): Promise<void> {
  const useCase = new SeedSuperAdminRoleUseCase({
    roleRepository: new RoleDbRepository(),
    permissionRepository: new PermissionDbRepository(),
    rolePermissionRepository: new RolePermissionDbRepository(),
  });

  await useCase.execute();
}

let exitCode = 0;

try {
  await main();
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  await closeDbConnection();
}

process.exit(exitCode);
