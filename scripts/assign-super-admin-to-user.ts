import { SetUserRolesUseCase } from "#/application/use-cases/rbac";
import { closeDbConnection } from "#/infrastructure/db/client";
import { RoleDbRepository } from "#/infrastructure/db/repositories/role.repo";
import { UserDbRepository } from "#/infrastructure/db/repositories/user.repo";
import { UserRoleDbRepository } from "#/infrastructure/db/repositories/user-role.repo";
import "#/env";

const SUPER_ADMIN_ROLE_NAME = "Super Admin";
const defaultEmail = "test@example.com";
const email =
  (process.env.SEED_USER_EMAIL as string | undefined)?.trim() || defaultEmail;

const userRepository = new UserDbRepository();
const roleRepository = new RoleDbRepository();
const userRoleRepository = new UserRoleDbRepository();

async function main(): Promise<void> {
  const user = await userRepository.findByEmail(email);
  if (!user) {
    throw new Error(`User not found: ${email}`);
  }

  const roles = await roleRepository.list();
  const superAdmin = roles.find((r) => r.name === SUPER_ADMIN_ROLE_NAME);
  if (!superAdmin) {
    throw new Error(
      `Role "${SUPER_ADMIN_ROLE_NAME}" not found. Run db:seed:super-admin first.`,
    );
  }

  const setUserRoles = new SetUserRolesUseCase({
    userRepository,
    roleRepository,
    userRoleRepository,
  });

  await setUserRoles.execute({
    userId: user.id,
    roleIds: [superAdmin.id],
  });

  console.log(
    `Assigned role "${SUPER_ADMIN_ROLE_NAME}" to ${email} (${user.id}).`,
  );
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
