import { SeedStandardPermissionsUseCase } from "#/application/use-cases/rbac";
import { closeDbConnection } from "#/infrastructure/db/client";
import { PermissionDbRepository } from "#/infrastructure/db/repositories/permission.repo";
import "#/env";

async function main(): Promise<void> {
  const useCase = new SeedStandardPermissionsUseCase({
    permissionRepository: new PermissionDbRepository(),
  });

  const result = await useCase.execute();
  console.log(`Seed standard permissions: ${result.created} created.`);
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
