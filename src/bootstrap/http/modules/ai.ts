import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type DisplayGroupRepository,
  type DisplayRepository,
} from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  AIChatUseCase,
  AIToolExecutor,
  DeleteAICredentialUseCase,
  ListAICredentialsUseCase,
  StoreAICredentialUseCase,
} from "#/application/use-cases/ai";
import { CreateFlashContentUseCase } from "#/application/use-cases/content/create-flash-content.use-case";
import { CreateTextContentUseCase } from "#/application/use-cases/content/create-text-content.use-case";
import { ListContentUseCase } from "#/application/use-cases/content/list-content.use-case";
import { ListDisplaysUseCase } from "#/application/use-cases/displays/list-displays.use-case";
import {
  CreatePlaylistUseCase,
  ReplacePlaylistItemsAtomicUseCase,
} from "#/application/use-cases/playlists";
import { ListPlaylistsUseCase } from "#/application/use-cases/playlists/list-playlists.use-case";
import { CheckPermissionUseCase } from "#/application/use-cases/rbac";
import { CreateScheduleUseCase } from "#/application/use-cases/schedules";
import { ListSchedulesUseCase } from "#/application/use-cases/schedules/list-schedules.use-case";
import { executeAIChat } from "#/infrastructure/ai/vercel-ai-adapter";
import { AIKeyEncryptionService } from "#/infrastructure/crypto/ai-key-encryption.service";
import { AICredentialsDbRepository } from "#/infrastructure/db/repositories/ai-credentials.repo";
import { logger } from "#/infrastructure/observability/logger";
import { type AuditLogQueue } from "#/interfaces/http/audit/audit-queue";
import {
  type AIRouterDeps,
  type AIRouterUseCases,
} from "#/interfaces/http/routes/ai/shared";
import { type AuthSecurityStore } from "#/interfaces/http/security/redis-auth-security.store";

export interface AIHttpModuleConfig {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
  encryptionKey: string;
  authSecurityStore: AuthSecurityStore;
  rateLimitWindowSeconds: number;
  rateLimitMaxRequests: number;
  auditQueue: AuditLogQueue;
  repositories: {
    authorizationRepository: AuthorizationRepository;
    contentRepository: ContentRepository;
    playlistRepository: PlaylistRepository;
    scheduleRepository: ScheduleRepository;
    displayRepository: DisplayRepository;
    displayGroupRepository: DisplayGroupRepository;
    userRepository: UserRepository;
  };
  storage: ContentStorage;
}

export interface AIHttpModule {
  deps: AIRouterDeps;
  useCases: AIRouterUseCases;
}

export const createAIModule = (config: AIHttpModuleConfig): AIHttpModule => {
  // Infrastructure
  const masterKey = Buffer.from(config.encryptionKey, "hex");
  const encryptionService = new AIKeyEncryptionService(masterKey);
  const credentialsRepository = new AICredentialsDbRepository();
  const checkPermissionUseCase = new CheckPermissionUseCase({
    authorizationRepository: config.repositories.authorizationRepository,
  });

  const auditLogger = {
    log(input: {
      event: string;
      userId: string;
      metadata?: Record<string, unknown>;
    }) {
      config.auditQueue
        .enqueue({
          action: input.event,
          actorId: input.userId,
          actorType: "user",
          method: "INTERNAL",
          path: "/internal/ai",
          status: 200,
          metadataJson: input.metadata
            ? JSON.stringify(input.metadata)
            : undefined,
        })
        .catch((error: unknown) => {
          logger.warn(
            {
              component: "ai",
              event: "audit.event.dropped",
              action: input.event,
              error: error instanceof Error ? error.message : String(error),
            },
            "AI audit event dropped",
          );
        });
    },
  };

  // Tool dependencies
  const createTextContentUseCase = new CreateTextContentUseCase({
    contentRepository: config.repositories.contentRepository,
    contentStorage: config.storage,
    userRepository: config.repositories.userRepository,
  });

  const createFlashContentUseCase = new CreateFlashContentUseCase({
    contentRepository: config.repositories.contentRepository,
    contentStorage: config.storage,
    userRepository: config.repositories.userRepository,
  });

  const createPlaylistUseCase = new CreatePlaylistUseCase({
    playlistRepository: config.repositories.playlistRepository,
    userRepository: config.repositories.userRepository,
  });

  const replacePlaylistItemsAtomicUseCase =
    new ReplacePlaylistItemsAtomicUseCase({
      playlistRepository: config.repositories.playlistRepository,
      contentRepository: config.repositories.contentRepository,
      scheduleRepository: config.repositories.scheduleRepository,
    });

  const createScheduleUseCase = new CreateScheduleUseCase({
    scheduleRepository: config.repositories.scheduleRepository,
    playlistRepository: config.repositories.playlistRepository,
    displayRepository: config.repositories.displayRepository,
    contentRepository: config.repositories.contentRepository,
  });

  const listDisplaysUseCase = new ListDisplaysUseCase({
    displayRepository: config.repositories.displayRepository,
    displayGroupRepository: config.repositories.displayGroupRepository,
    scheduleRepository: config.repositories.scheduleRepository,
    playlistRepository: config.repositories.playlistRepository,
  });

  const listContentUseCase = new ListContentUseCase({
    contentRepository: config.repositories.contentRepository,
    userRepository: config.repositories.userRepository,
    contentStorage: config.storage,
    thumbnailUrlExpiresInSeconds: 3600,
  });

  const listPlaylistsUseCase = new ListPlaylistsUseCase({
    playlistRepository: config.repositories.playlistRepository,
    contentRepository: config.repositories.contentRepository,
    userRepository: config.repositories.userRepository,
  });

  const listSchedulesUseCase = new ListSchedulesUseCase({
    scheduleRepository: config.repositories.scheduleRepository,
    playlistRepository: config.repositories.playlistRepository,
    contentRepository: config.repositories.contentRepository,
    displayRepository: config.repositories.displayRepository,
  });

  const toolExecutor = new AIToolExecutor({
    createFlashContentUseCase,
    createTextContentUseCase,
    createPlaylistUseCase,
    replacePlaylistItemsAtomicUseCase,
    createScheduleUseCase,
    listDisplaysUseCase,
    listContentUseCase,
    listPlaylistsUseCase,
    listSchedulesUseCase,
    contentRepository: config.repositories.contentRepository,
    playlistRepository: config.repositories.playlistRepository,
    scheduleRepository: config.repositories.scheduleRepository,
    auditLogger,
  });

  // Use cases
  const aiChat = new AIChatUseCase({
    credentialsRepository,
    encryptionService,
    toolExecutor,
    auditLogger,
    executeAIChat,
  });

  const storeCredential = new StoreAICredentialUseCase({
    credentialsRepository,
    encryptionService,
    auditLogger,
  });

  const listCredentials = new ListAICredentialsUseCase({
    credentialsRepository,
  });

  const deleteCredential = new DeleteAICredentialUseCase({
    credentialsRepository,
    auditLogger,
  });

  return {
    deps: {
      jwtSecret: config.jwtSecret,
      authSessionRepository: config.authSessionRepository,
      authSessionCookieName: config.authSessionCookieName,
      checkPermissionUseCase,
      repositories: {
        authorizationRepository: config.repositories.authorizationRepository,
      },
      authSecurityStore: config.authSecurityStore,
      rateLimitWindowSeconds: config.rateLimitWindowSeconds,
      rateLimitMaxRequests: config.rateLimitMaxRequests,
    },
    useCases: {
      aiChat,
      storeCredential,
      listCredentials,
      deleteCredential,
    },
  };
};
