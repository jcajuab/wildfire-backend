import { eq } from "drizzle-orm";
import { ADMIN_ROLE_NAME } from "#/domain/rbac/canonical-permissions";
import { db } from "#/infrastructure/db/client";
import { roles, userRoles, users } from "#/infrastructure/db/schema/rbac.sql";

const parseArgs = (argv: string[]): { email: string } => {
  const emailFlag = argv.find((arg) => arg.startsWith("--email="));
  if (!emailFlag) {
    throw new Error(
      'Missing required flag: --email=<address>. Example: bun run db:set-admin -- --email="admin@example.com"',
    );
  }
  const email = emailFlag.slice("--email=".length).trim();
  if (!email) {
    throw new Error("--email value cannot be empty");
  }
  const unknownFlags = argv.filter(
    (arg) => arg.startsWith("--") && !arg.startsWith("--email="),
  );
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown flag(s): ${unknownFlags.join(", ")}`);
  }
  return { email };
};

async function main(): Promise<void> {
  const { email } = parseArgs(process.argv.slice(2));

  // Find the Admin role
  const adminRoleRows = await db
    .select()
    .from(roles)
    .where(eq(roles.name, ADMIN_ROLE_NAME))
    .limit(1);
  const adminRole = adminRoleRows[0];
  if (!adminRole) {
    throw new Error(
      `Admin role ("${ADMIN_ROLE_NAME}") not found in the database. Has the server been booted at least once?`,
    );
  }

  // Find the user by email
  const normalizedEmail = email.toLowerCase();
  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);
  const user = userRows[0];
  if (!user) {
    throw new Error(`No user found with email: ${email}`);
  }

  // Check if the user already has the Admin role
  const existingAssignment = await db
    .select()
    .from(userRoles)
    .where(eq(userRoles.userId, user.id))
    .then((rows) => rows.find((r) => r.roleId === adminRole.id));

  if (existingAssignment) {
    console.log(
      `User "${user.username}" (${user.email}) already has the Admin role. No changes made.`,
    );
    return;
  }

  // Assign Admin role
  await db.insert(userRoles).values({ userId: user.id, roleId: adminRole.id });

  console.log(
    `Done. Admin role assigned to "${user.username}" (${user.email}).`,
  );
}

if (import.meta.main) {
  let exitCode = 0;
  try {
    await main();
  } catch (error) {
    exitCode = 1;
    console.error(error instanceof Error ? error.message : error);
  }

  process.exit(exitCode);
}
