import { BcryptPasswordHasher } from "#/infrastructure/auth/bcrypt-password.hasher";
import { BcryptPasswordVerifier } from "#/infrastructure/auth/bcrypt-password.verifier";
import { HtshadowCredentialsRepository } from "#/infrastructure/auth/htshadow.repo";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { AuditEventDbRepository } from "#/infrastructure/db/repositories/audit-event.repo";
import { AuthSessionRedisRepository } from "#/infrastructure/db/repositories/auth-session.repo";
import { AuthorizationDbRepository } from "#/infrastructure/db/repositories/authorization.repo";
import { ContentDbRepository } from "#/infrastructure/db/repositories/content.repo";
import { ContentIngestionJobDbRepository } from "#/infrastructure/db/repositories/content-job.repo";
import { DisplayDbRepository } from "#/infrastructure/db/repositories/display.repo";
import { DisplayAuthNonceRedisRepository } from "#/infrastructure/db/repositories/display-auth-nonce.repo";
import { DisplayGroupDbRepository } from "#/infrastructure/db/repositories/display-group.repo";
import { DisplayKeyDbRepository } from "#/infrastructure/db/repositories/display-key.repo";
import { DisplayPairingCodeRedisRepository } from "#/infrastructure/db/repositories/display-pairing-code.repo";
import { DisplayPairingSessionRedisRepository } from "#/infrastructure/db/repositories/display-pairing-session.repo";
import { EmailChangeTokenRedisRepository } from "#/infrastructure/db/repositories/email-change-token.repo";
import { InvitationRedisRepository } from "#/infrastructure/db/repositories/invitation.repo";
import { PasswordResetTokenRedisRepository } from "#/infrastructure/db/repositories/password-reset-token.repo";
import { PermissionDbRepository } from "#/infrastructure/db/repositories/permission.repo";
import { PlaylistDbRepository } from "#/infrastructure/db/repositories/playlist.repo";
import { RoleDbRepository } from "#/infrastructure/db/repositories/role.repo";
import { RolePermissionDbRepository } from "#/infrastructure/db/repositories/role-permission.repo";
import { ScheduleDbRepository } from "#/infrastructure/db/repositories/schedule.repo";
import { UserDbRepository } from "#/infrastructure/db/repositories/user.repo";
import { UserRoleDbRepository } from "#/infrastructure/db/repositories/user-role.repo";
import { DefaultContentMetadataExtractor } from "#/infrastructure/media/content-metadata.extractor";
import { DefaultContentThumbnailGenerator } from "#/infrastructure/media/content-thumbnail.generator";
import { LogEmailChangeVerificationEmailSender } from "#/infrastructure/notifications/log-email-change-verification-email.sender";
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
    authorizationRepository: AuthorizationDbRepository;
    authSessionRepository: AuthSessionRedisRepository;
    auditEventRepository: AuditEventDbRepository;
    contentIngestionJobRepository: ContentIngestionJobDbRepository;
    contentRepository: ContentDbRepository;
    playlistRepository: PlaylistDbRepository;
    scheduleRepository: ScheduleDbRepository;
    displayRepository: DisplayDbRepository;
    displayGroupRepository: DisplayGroupDbRepository;
    displayPairingCodeRepository: DisplayPairingCodeRedisRepository;
    displayKeyRepository: DisplayKeyDbRepository;
    displayPairingSessionRepository: DisplayPairingSessionRedisRepository;
    displayAuthNonceRepository: DisplayAuthNonceRedisRepository;
    passwordResetTokenRepository: PasswordResetTokenRedisRepository;
    emailChangeTokenRepository: EmailChangeTokenRedisRepository;
    invitationRepository: InvitationRedisRepository;
  };
  auth: {
    credentialsRepository: HtshadowCredentialsRepository;
    passwordVerifier: BcryptPasswordVerifier;
    passwordHasher: BcryptPasswordHasher;
    tokenIssuer: JwtTokenIssuer;
    clock: SystemClock;
    emailChangeVerificationEmailSender: LogEmailChangeVerificationEmailSender;
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
  const authorizationRepository = new AuthorizationDbRepository();
  const authSessionRepository = new AuthSessionRedisRepository();
  const auditEventRepository = new AuditEventDbRepository();
  const contentIngestionJobRepository = new ContentIngestionJobDbRepository();
  const contentRepository = new ContentDbRepository();
  const playlistRepository = new PlaylistDbRepository();
  const scheduleRepository = new ScheduleDbRepository();
  const displayRepository = new DisplayDbRepository();
  const displayGroupRepository = new DisplayGroupDbRepository();
  const displayPairingCodeRepository = new DisplayPairingCodeRedisRepository();
  const displayKeyRepository = new DisplayKeyDbRepository();
  const displayPairingSessionRepository =
    new DisplayPairingSessionRedisRepository();
  const displayAuthNonceRepository = new DisplayAuthNonceRedisRepository();
  const passwordResetTokenRepository = new PasswordResetTokenRedisRepository();
  const emailChangeTokenRepository = new EmailChangeTokenRedisRepository();
  const invitationRepository = new InvitationRedisRepository();

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
  const emailChangeVerificationEmailSender =
    new LogEmailChangeVerificationEmailSender();
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
      authorizationRepository,
      authSessionRepository,
      auditEventRepository,
      contentIngestionJobRepository,
      contentRepository,
      playlistRepository,
      scheduleRepository,
      displayRepository,
      displayGroupRepository,
      displayPairingCodeRepository,
      displayKeyRepository,
      displayPairingSessionRepository,
      displayAuthNonceRepository,
      passwordResetTokenRepository,
      emailChangeTokenRepository,
      invitationRepository,
    },
    auth: {
      credentialsRepository,
      passwordVerifier,
      passwordHasher,
      tokenIssuer,
      clock,
      emailChangeVerificationEmailSender,
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
