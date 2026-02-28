import { writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { env } from "#/env";
import { closeDbConnection } from "#/infrastructure/db/client";
import { PermissionDbRepository } from "#/infrastructure/db/repositories/permission.repo";
import { RoleDbRepository } from "#/infrastructure/db/repositories/role.repo";
import { RolePermissionDbRepository } from "#/infrastructure/db/repositories/role-permission.repo";
import { UserDbRepository } from "#/infrastructure/db/repositories/user.repo";
import { UserRoleDbRepository } from "#/infrastructure/db/repositories/user-role.repo";
import { type SeedArgs } from "./args";
import { type SeedContext } from "./stage-types";

export interface SeedRuntimeContext {
  ctx: SeedContext;
  close(): Promise<void>;
}

export const createSeedRuntimeContext = (input: {
  args: SeedArgs;
  targetEmail: string;
}): SeedRuntimeContext => {
  const ctx: SeedContext = {
    args: input.args,
    targetEmail: input.targetEmail,
    htshadowPath: env.HTSHADOW_PATH,
    repos: {
      permissionRepository: new PermissionDbRepository(),
      roleRepository: new RoleDbRepository(),
      rolePermissionRepository: new RolePermissionDbRepository(),
      userRepository: new UserDbRepository(),
      userRoleRepository: new UserRoleDbRepository(),
    },
    io: {
      hashPassword: (password, saltRounds) => bcrypt.hash(password, saltRounds),
      writeFile: (path, data) => writeFile(path, data, "utf-8"),
    },
  };

  return {
    ctx,
    close: closeDbConnection,
  };
};
