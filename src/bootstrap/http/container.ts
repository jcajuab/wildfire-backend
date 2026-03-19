import { type CredentialsReader } from "#/application/ports/auth";
import { BcryptPasswordHasher } from "#/infrastructure/auth/bcrypt-password.hasher";
import { BcryptPasswordVerifier } from "#/infrastructure/auth/bcrypt-password.verifier";
import { HtshadowCredentialsRepository } from "#/infrastructure/auth/htshadow.repo";
import { JwtTokenIssuer } from "#/infrastructure/auth/jwt";
import { AuditLogDbRepository } from "#/infrastructure/db/repositories/audit-logs.repo";
import { AuthSessionDbRepository } from "#/infrastructure/db/repositories/auth-session.repo";
import { AuthorizationDbRepository } from "#/infrastructure/db/repositories/authorization.repo";
import { ContentDbRepository } from "#/infrastructure/db/repositories/content.repo";
import { ContentIngestionJobDbRepository } from "#/infrastructure/db/repositories/content-job.repo";
import { DisplayDbRepository } from "#/infrastructure/db/repositories/display.repo";
import { DisplayAuthNonceRedisRepository } from "#/infrastructure/db/repositories/display-auth-nonce.repo";
import { DisplayGroupDbRepository } from "#/infrastructure/db/repositories/display-groups.repo";
import { DisplayKeyDbRepository } from "#/infrastructure/db/repositories/display-key.repo";
import { DisplayPairingCodeRedisRepository } from "#/infrastructure/db/repositories/display-pairing-code.repo";
import { DisplayPairingSessionRedisRepository } from "#/infrastructure/db/repositories/display-pairing-session.repo";
import { DisplayPreviewRedisRepository } from "#/infrastructure/db/repositories/display-preview.repo";
import { InvitationDbRepository } from "#/infrastructure/db/repositories/invitation.repo";
import { DbCredentialsRepository } from "#/infrastructure/db/repositories/password-hashes.repo";
import { PermissionDbRepository } from "#/infrastructure/db/repositories/permission.repo";
import { PlaylistDbRepository } from "#/infrastructure/db/repositories/playlist.repo";
import { RoleDbRepository } from "#/infrastructure/db/repositories/role.repo";
import { RolePermissionDbRepository } from "#/infrastructure/db/repositories/role-permission.repo";
import { RuntimeControlDbRepository } from "#/infrastructure/db/repositories/runtime-control.repo";
import { ScheduleDbRepository } from "#/infrastructure/db/repositories/schedule.repo";
import { UserDbRepository } from "#/infrastructure/db/repositories/user.repo";
import { UserRoleDbRepository } from "#/infrastructure/db/repositories/user-role.repo";
import { DefaultContentMetadataExtractor } from "#/infrastructure/media/content-metadata.extractor";
import { DefaultContentThumbnailGenerator } from "#/infrastructure/media/content-thumbnail.generator";
import { PdftoppmCropRenderer } from "#/infrastructure/media/pdf-crop.renderer";
import { RedisPdfCropSessionStore } from "#/infrastructure/media/pdf-crop-session.store";
import { PdfLibPageExtractor } from "#/infrastructure/media/pdf-page.extractor";
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
    // Auth & sessions
    authSessionRepository: AuthSessionDbRepository;
    invitationRepository: InvitationDbRepository;
    // RBAC
    userRepository: UserDbRepository;
    roleRepository: RoleDbRepository;
    permissionRepository: PermissionDbRepository;
    userRoleRepository: UserRoleDbRepository;
    rolePermissionRepository: RolePermissionDbRepository;
    authorizationRepository: AuthorizationDbRepository;
    // Content
    contentRepository: ContentDbRepository;
    contentIngestionJobRepository: ContentIngestionJobDbRepository;
    // Playlists & schedules
    playlistRepository: PlaylistDbRepository;
    scheduleRepository: ScheduleDbRepository;
    // Displays
    displayRepository: DisplayDbRepository;
    displayGroupRepository: DisplayGroupDbRepository;
    displayKeyRepository: DisplayKeyDbRepository;
    displayPairingCodeRepository: DisplayPairingCodeRedisRepository;
    displayPairingSessionRepository: DisplayPairingSessionRedisRepository;
    displayAuthNonceRepository: DisplayAuthNonceRedisRepository;
    displayPreviewRepository: DisplayPreviewRedisRepository;
    runtimeControlRepository: RuntimeControlDbRepository;
    // Audit
    auditLogRepository: AuditLogDbRepository;
  };
  auth: {
    /** Read-only htshadow credential lookup; Wildfire must not write to htshadow. */
    credentialsRepository: CredentialsReader;
    dbCredentialsRepository: DbCredentialsRepository;
    passwordVerifier: BcryptPasswordVerifier;
    passwordHasher: BcryptPasswordHasher;
    tokenIssuer: JwtTokenIssuer;
    clock: SystemClock;
  };
  storage: {
    contentStorage: S3ContentStorage;
    contentMetadataExtractor: DefaultContentMetadataExtractor;
    contentThumbnailGenerator: DefaultContentThumbnailGenerator;
    pdfCropSessionStore: RedisPdfCropSessionStore;
    pdfPageExtractor: PdfLibPageExtractor;
    pdfCropRenderer: PdftoppmCropRenderer;
    minioEndpoint: string;
  };
}

export const createHttpContainer = (
  config: HttpContainerConfig,
): HttpContainer => {
  const minioEndpoint = `${config.minio.useSsl ? "https" : "http"}://${config.minio.endpoint}:${config.minio.port}`;

  // Auth & sessions
  const authSessionRepository = new AuthSessionDbRepository();
  const invitationRepository = new InvitationDbRepository();

  // RBAC
  const userRepository = new UserDbRepository();
  const roleRepository = new RoleDbRepository();
  const permissionRepository = new PermissionDbRepository();
  const userRoleRepository = new UserRoleDbRepository();
  const rolePermissionRepository = new RolePermissionDbRepository();
  const authorizationRepository = new AuthorizationDbRepository();

  // Content
  const contentRepository = new ContentDbRepository();
  const contentIngestionJobRepository = new ContentIngestionJobDbRepository();

  // Playlists & schedules
  const playlistRepository = new PlaylistDbRepository();
  const scheduleRepository = new ScheduleDbRepository();

  // Displays
  const displayRepository = new DisplayDbRepository();
  const displayGroupRepository = new DisplayGroupDbRepository();
  const displayKeyRepository = new DisplayKeyDbRepository();
  const displayPairingCodeRepository = new DisplayPairingCodeRedisRepository();
  const displayPairingSessionRepository =
    new DisplayPairingSessionRedisRepository();
  const displayAuthNonceRepository = new DisplayAuthNonceRedisRepository();
  const displayPreviewRepository = new DisplayPreviewRedisRepository();
  const runtimeControlRepository = new RuntimeControlDbRepository();

  // Audit
  const auditLogRepository = new AuditLogDbRepository();

  const credentialsRepository = new HtshadowCredentialsRepository({
    filePath: config.htshadowPath,
  });
  const dbCredentialsRepository = new DbCredentialsRepository();
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
  const contentMetadataExtractor = new DefaultContentMetadataExtractor();
  const contentThumbnailGenerator = new DefaultContentThumbnailGenerator();
  const pdfCropSessionStore = new RedisPdfCropSessionStore();
  const pdfPageExtractor = new PdfLibPageExtractor();
  const pdfCropRenderer = new PdftoppmCropRenderer();

  return {
    repositories: {
      authSessionRepository,
      invitationRepository,
      userRepository,
      roleRepository,
      permissionRepository,
      userRoleRepository,
      rolePermissionRepository,
      authorizationRepository,
      contentRepository,
      contentIngestionJobRepository,
      playlistRepository,
      scheduleRepository,
      displayRepository,
      displayGroupRepository,
      displayKeyRepository,
      displayPairingCodeRepository,
      displayPairingSessionRepository,
      displayAuthNonceRepository,
      displayPreviewRepository,
      runtimeControlRepository,
      auditLogRepository,
    },
    auth: {
      credentialsRepository,
      dbCredentialsRepository,
      passwordVerifier,
      passwordHasher,
      tokenIssuer,
      clock,
    },
    storage: {
      contentStorage,
      contentMetadataExtractor,
      contentThumbnailGenerator,
      pdfCropSessionStore,
      pdfPageExtractor,
      pdfCropRenderer,
      minioEndpoint,
    },
  };
};
