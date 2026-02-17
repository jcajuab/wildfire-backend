import { BcryptPasswordHasher } from "#/infrastructure/auth/bcrypt-password.hasher";
import { BcryptPasswordVerifier } from "#/infrastructure/auth/bcrypt-password.verifier";
import { HtshadowCredentialsRepository } from "#/infrastructure/auth/htshadow.repo";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { AuditEventDbRepository } from "#/infrastructure/db/repositories/audit-event.repo";
import { AuthSessionDbRepository } from "#/infrastructure/db/repositories/auth-session.repo";
import { AuthorizationDbRepository } from "#/infrastructure/db/repositories/authorization.repo";
import { ContentDbRepository } from "#/infrastructure/db/repositories/content.repo";
import { DeviceDbRepository } from "#/infrastructure/db/repositories/device.repo";
import { PermissionDbRepository } from "#/infrastructure/db/repositories/permission.repo";
import { PlaylistDbRepository } from "#/infrastructure/db/repositories/playlist.repo";
import { RoleDbRepository } from "#/infrastructure/db/repositories/role.repo";
import { RolePermissionDbRepository } from "#/infrastructure/db/repositories/role-permission.repo";
import { ScheduleDbRepository } from "#/infrastructure/db/repositories/schedule.repo";
import { UserDbRepository } from "#/infrastructure/db/repositories/user.repo";
import { UserRoleDbRepository } from "#/infrastructure/db/repositories/user-role.repo";
import { S3ContentStorage } from "#/infrastructure/storage/s3-content.storage";
import { SystemClock } from "#/infrastructure/time/system.clock";

export interface HttpContainerConfig {
  jwtSecret: string;
  jwtIssuer?: string;
  htshadowPath: string;
  minio: {
    endpoint: string;
    port: number;
    useSsl: boolean;
    bucket: string;
    region: string;
    rootUser: string;
    rootPassword: string;
    requestTimeoutMs: number;
  };
}

export interface HttpContainer {
  repositories: {
    userRepository: UserDbRepository;
    roleRepository: RoleDbRepository;
    permissionRepository: PermissionDbRepository;
    userRoleRepository: UserRoleDbRepository;
    rolePermissionRepository: RolePermissionDbRepository;
    authorizationRepository: AuthorizationDbRepository;
    authSessionRepository: AuthSessionDbRepository;
    auditEventRepository: AuditEventDbRepository;
    contentRepository: ContentDbRepository;
    playlistRepository: PlaylistDbRepository;
    scheduleRepository: ScheduleDbRepository;
    deviceRepository: DeviceDbRepository;
  };
  auth: {
    credentialsRepository: HtshadowCredentialsRepository;
    passwordVerifier: BcryptPasswordVerifier;
    passwordHasher: BcryptPasswordHasher;
    tokenIssuer: JwtTokenIssuer;
    clock: SystemClock;
  };
  storage: {
    contentStorage: S3ContentStorage;
    minioEndpoint: string;
  };
}

export const createHttpContainer = (
  config: HttpContainerConfig,
): HttpContainer => {
  const minioEndpoint = `${config.minio.useSsl ? "https" : "http"}://${config.minio.endpoint}:${config.minio.port}`;

  const userRepository = new UserDbRepository();
  const roleRepository = new RoleDbRepository();
  const permissionRepository = new PermissionDbRepository();
  const userRoleRepository = new UserRoleDbRepository();
  const rolePermissionRepository = new RolePermissionDbRepository();
  const authorizationRepository = new AuthorizationDbRepository();
  const authSessionRepository = new AuthSessionDbRepository();
  const auditEventRepository = new AuditEventDbRepository();
  const contentRepository = new ContentDbRepository();
  const playlistRepository = new PlaylistDbRepository();
  const scheduleRepository = new ScheduleDbRepository();
  const deviceRepository = new DeviceDbRepository();

  const credentialsRepository = new HtshadowCredentialsRepository({
    filePath: config.htshadowPath,
  });
  const passwordVerifier = new BcryptPasswordVerifier();
  const passwordHasher = new BcryptPasswordHasher();
  const tokenIssuer = new JwtTokenIssuer({
    secret: config.jwtSecret,
    issuer: config.jwtIssuer,
  });
  const clock = new SystemClock();

  const contentStorage = new S3ContentStorage({
    bucket: config.minio.bucket,
    region: config.minio.region,
    endpoint: minioEndpoint,
    accessKeyId: config.minio.rootUser,
    secretAccessKey: config.minio.rootPassword,
    requestTimeoutMs: config.minio.requestTimeoutMs,
  });

  return {
    repositories: {
      userRepository,
      roleRepository,
      permissionRepository,
      userRoleRepository,
      rolePermissionRepository,
      authorizationRepository,
      authSessionRepository,
      auditEventRepository,
      contentRepository,
      playlistRepository,
      scheduleRepository,
      deviceRepository,
    },
    auth: {
      credentialsRepository,
      passwordVerifier,
      passwordHasher,
      tokenIssuer,
      clock,
    },
    storage: {
      contentStorage,
      minioEndpoint,
    },
  };
};
