import { readFile, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { env } from "#/env";
import { closeDbConnection } from "#/infrastructure/db/client";
import { AuditEventDbRepository } from "#/infrastructure/db/repositories/audit-event.repo";
import { ContentDbRepository } from "#/infrastructure/db/repositories/content.repo";
import { DisplayDbRepository } from "#/infrastructure/db/repositories/display.repo";
import { DisplayGroupDbRepository } from "#/infrastructure/db/repositories/display-group.repo";
import { PermissionDbRepository } from "#/infrastructure/db/repositories/permission.repo";
import { PlaylistDbRepository } from "#/infrastructure/db/repositories/playlist.repo";
import { RoleDbRepository } from "#/infrastructure/db/repositories/role.repo";
import { RolePermissionDbRepository } from "#/infrastructure/db/repositories/role-permission.repo";
import { ScheduleDbRepository } from "#/infrastructure/db/repositories/schedule.repo";
import { UserDbRepository } from "#/infrastructure/db/repositories/user.repo";
import { UserRoleDbRepository } from "#/infrastructure/db/repositories/user-role.repo";
import { S3ContentStorage } from "#/infrastructure/storage/s3-content.storage";
import { type SeedArgs } from "./args";
import { type SeedContext } from "./stage-types";

export interface SeedRuntimeContext {
  ctx: SeedContext;
  close(): Promise<void>;
}

export const createSeedRuntimeContext = (input: {
  args: SeedArgs;
}): SeedRuntimeContext => {
  const minioEndpoint = `${env.MINIO_USE_SSL ? "https" : "http"}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`;
  const contentStorage = new S3ContentStorage({
    bucket: env.MINIO_BUCKET,
    region: env.MINIO_REGION,
    endpoint: minioEndpoint,
    accessKeyId: env.MINIO_ROOT_USER,
    secretAccessKey: env.MINIO_ROOT_PASSWORD,
    requestTimeoutMs: env.MINIO_REQUEST_TIMEOUT_MS,
  });

  const ctx: SeedContext = {
    args: input.args,
    htshadowPath: env.HTSHADOW_PATH,
    repos: {
      permissionRepository: new PermissionDbRepository(),
      roleRepository: new RoleDbRepository(),
      rolePermissionRepository: new RolePermissionDbRepository(),
      userRepository: new UserDbRepository(),
      userRoleRepository: new UserRoleDbRepository(),
      displayRepository: new DisplayDbRepository(),
      displayGroupRepository: new DisplayGroupDbRepository(),
      contentRepository: new ContentDbRepository(),
      playlistRepository: new PlaylistDbRepository(),
      scheduleRepository: new ScheduleDbRepository(),
      auditEventRepository: new AuditEventDbRepository(),
    },
    storage: {
      contentStorage,
    },
    io: {
      readFile: (path) => readFile(path, "utf-8"),
      hashPassword: (password, saltRounds) => bcrypt.hash(password, saltRounds),
      writeFile: (path, data) => writeFile(path, data, "utf-8"),
    },
  };

  return {
    ctx,
    close: closeDbConnection,
  };
};
