import { SetUserRolesUseCase } from "#/application/use-cases/rbac";
import { closeDbConnection } from "#/infrastructure/db/client";
import { RoleDbRepository } from "#/infrastructure/db/repositories/role.repo";
import { UserDbRepository } from "#/infrastructure/db/repositories/user.repo";
import { UserRoleDbRepository } from "#/infrastructure/db/repositories/user-role.repo";
import "#/env";

// This is the default super admin role name. This can be changed, but it's best to keep it as "Super Admin".
const SUPER_ADMIN_ROLE_NAME = "Super Admin";
// This is the fallback email if SEED_USER_EMAIL is not set in .env file.
const defaultEmail = "test@example.com";

const EMAIL_FLAG_PREFIX = "--email=";

function printEmailUsage(): void {
  console.error(
    "The only accepted flag is --email. Usage:\n" +
      "`bun run db:seed:assign-super-admin -- --email=user@example.com`\n" +
      "Or omit the flag to use SEED_USER_EMAIL from .env or the default email.",
  );
}

function checkFlags(): void {
  // argv[0] = runtime, argv[1] = script path; rest are user args
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const isEmailFlag =
      arg === "--email" ||
      (arg.startsWith(EMAIL_FLAG_PREFIX) &&
        arg.length > EMAIL_FLAG_PREFIX.length);
    if (!isEmailFlag) {
      console.error(`Unknown flag: ${arg}\n`);
      printEmailUsage();
      process.exit(1);
    }
  }
}

function resolveEmail(): string {
  for (const arg of process.argv) {
    if (arg.startsWith(EMAIL_FLAG_PREFIX)) {
      const value = arg.slice(EMAIL_FLAG_PREFIX.length);
      if (value.length > 0) return value;
    }
  }
  const fromEnv = (process.env.SEED_USER_EMAIL as string | undefined)?.trim();
  return fromEnv || defaultEmail;
}
const userRepository = new UserDbRepository();
const roleRepository = new RoleDbRepository();
const userRoleRepository = new UserRoleDbRepository();

async function main(): Promise<void> {
  const email = resolveEmail();
  const user = await userRepository.findByEmail(email);
  if (!user) {
    throw new Error(`User not found for email: ${email}`);
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

checkFlags();

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
