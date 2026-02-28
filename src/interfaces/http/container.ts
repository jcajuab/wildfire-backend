import { BcryptPasswordHasher } from "#/infrastructure/auth/bcrypt-password.hasher";
import { BcryptPasswordVerifier } from "#/infrastructure/auth/bcrypt-password.verifier";
import { HtshadowCredentialsRepository } from "#/infrastructure/auth/htshadow.repo";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { AuditEventDbRepository } from "#/infrastructure/db/repositories/audit-event.repo";
import { AuthSessionDbRepository } from "#/infrastructure/db/repositories/auth-session.repo";
import { AuthorizationDbRepository } from "#/infrastructure/db/repositories/authorization.repo";
import { ContentDbRepository } from "#/infrastructure/db/repositories/content.repo";
import { DisplayDbRepository } from "#/infrastructure/db/repositories/display.repo";
import { DisplayGroupDbRepository } from "#/infrastructure/db/repositories/display-group.repo";
import { DisplayPairingCodeDbRepository } from "#/infrastructure/db/repositories/display-pairing-code.repo";
import { InvitationDbRepository } from "#/infrastructure/db/repositories/invitation.repo";
import { PasswordResetTokenDbRepository } from "#/infrastructure/db/repositories/password-reset-token.repo";
import { PermissionDbRepository } from "#/infrastructure/db/repositories/permission.repo";
import { PlaylistDbRepository } from "#/infrastructure/db/repositories/playlist.repo";
import { PolicyHistoryDbRepository } from "#/infrastructure/db/repositories/policy-history.repo";
import { RoleDbRepository } from "#/infrastructure/db/repositories/role.repo";
import { RoleDeletionRequestDbRepository } from "#/infrastructure/db/repositories/role-deletion-request.repo";
import { RolePermissionDbRepository } from "#/infrastructure/db/repositories/role-permission.repo";
import { ScheduleDbRepository } from "#/infrastructure/db/repositories/schedule.repo";
import { SystemSettingDbRepository } from "#/infrastructure/db/repositories/system-setting.repo";
import { UserDbRepository } from "#/infrastructure/db/repositories/user.repo";
import { UserRoleDbRepository } from "#/infrastructure/db/repositories/user-role.repo";
import { DefaultContentMetadataExtractor } from "#/infrastructure/media/content-metadata.extractor";
import { DefaultContentThumbnailGenerator } from "#/infrastructure/media/content-thumbnail.generator";
import { LogInvitationEmailSender } from "#/infrastructure/notifications/log-invitation-email.sender";
import { LogPasswordResetEmailSender } from "#/infrastructure/notifications/log-password-reset-email.sender";
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
    policyHistoryRepository: PolicyHistoryDbRepository;
    roleDeletionRequestRepository: RoleDeletionRequestDbRepository;
    authorizationRepository: AuthorizationDbRepository;
    authSessionRepository: AuthSessionDbRepository;
    auditEventRepository: AuditEventDbRepository;
    contentRepository: ContentDbRepository;
    playlistRepository: PlaylistDbRepository;
    scheduleRepository: ScheduleDbRepository;
    displayRepository: DisplayDbRepository;
    displayGroupRepository: DisplayGroupDbRepository;
    displayPairingCodeRepository: DisplayPairingCodeDbRepository;
    passwordResetTokenRepository: PasswordResetTokenDbRepository;
    invitationRepository: InvitationDbRepository;
    systemSettingRepository: SystemSettingDbRepository;
  };
  auth: {
    credentialsRepository: HtshadowCredentialsRepository;
    passwordVerifier: BcryptPasswordVerifier;
    passwordHasher: BcryptPasswordHasher;
    tokenIssuer: JwtTokenIssuer;
    clock: SystemClock;
    invitationEmailSender: LogInvitationEmailSender;
    passwordResetEmailSender: LogPasswordResetEmailSender;
  };
  storage: {
    contentStorage: S3ContentStorage;
    contentMetadataExtractor: DefaultContentMetadataExtractor;
    contentThumbnailGenerator: DefaultContentThumbnailGenerator;
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
  const policyHistoryRepository = new PolicyHistoryDbRepository();
  const roleDeletionRequestRepository = new RoleDeletionRequestDbRepository();
  const authorizationRepository = new AuthorizationDbRepository();
  const authSessionRepository = new AuthSessionDbRepository();
  const auditEventRepository = new AuditEventDbRepository();
  const contentRepository = new ContentDbRepository();
  const playlistRepository = new PlaylistDbRepository();
  const scheduleRepository = new ScheduleDbRepository();
  const displayRepository = new DisplayDbRepository();
  const displayGroupRepository = new DisplayGroupDbRepository();
  const displayPairingCodeRepository = new DisplayPairingCodeDbRepository();
  const passwordResetTokenRepository = new PasswordResetTokenDbRepository();
  const invitationRepository = new InvitationDbRepository();
  const systemSettingRepository = new SystemSettingDbRepository();

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
  const invitationEmailSender = new LogInvitationEmailSender();
  const passwordResetEmailSender = new LogPasswordResetEmailSender();

  const contentStorage = new S3ContentStorage({
    bucket: config.minio.bucket,
    region: config.minio.region,
    endpoint: minioEndpoint,
    accessKeyId: config.minio.rootUser,
    secretAccessKey: config.minio.rootPassword,
    requestTimeoutMs: config.minio.requestTimeoutMs,
  });
  const contentMetadataExtractor = new DefaultContentMetadataExtractor();
  const contentThumbnailGenerator = new DefaultContentThumbnailGenerator();

  return {
    repositories: {
      userRepository,
      roleRepository,
      permissionRepository,
      userRoleRepository,
      rolePermissionRepository,
      policyHistoryRepository,
      roleDeletionRequestRepository,
      authorizationRepository,
      authSessionRepository,
      auditEventRepository,
      contentRepository,
      playlistRepository,
      scheduleRepository,
      displayRepository,
      displayGroupRepository,
      displayPairingCodeRepository,
      passwordResetTokenRepository,
      invitationRepository,
      systemSettingRepository,
    },
    auth: {
      credentialsRepository,
      passwordVerifier,
      passwordHasher,
      tokenIssuer,
      clock,
      invitationEmailSender,
      passwordResetEmailSender,
    },
    storage: {
      contentStorage,
      contentMetadataExtractor,
      contentThumbnailGenerator,
      minioEndpoint,
    },
  };
};
