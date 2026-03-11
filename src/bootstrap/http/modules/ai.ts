import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type PlaylistRepository } from "#/application/ports/playlists";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  AIChatUseCase,
  AIConfirmActionUseCase,
  AIToolExecutor,
  CancelPendingActionUseCase,
  DeleteAICredentialUseCase,
  ListAICredentialsUseCase,
  ListPendingActionsUseCase,
  StoreAICredentialUseCase,
} from "#/application/use-cases/ai";
import { CreateTextContentUseCase } from "#/application/use-cases/content/create-text-content.use-case";
import { CreatePlaylistUseCase } from "#/application/use-cases/playlists/playlist.use-cases";
import { CheckPermissionUseCase } from "#/application/use-cases/rbac";
import { CreateScheduleUseCase } from "#/application/use-cases/schedules/schedule.use-cases";
import { RedisPendingActionStore } from "#/infrastructure/ai/redis-pending-action.store";
import { executeAIChat } from "#/infrastructure/ai/vercel-ai-adapter";
import { AIKeyEncryptionService } from "#/infrastructure/crypto/ai-key-encryption.service";
import { AICredentialsRepo } from "#/infrastructure/db/repositories/ai-credentials.repo";
import { type DisplayDbRepository } from "#/infrastructure/db/repositories/display.repo";
import {
  type AIRouterDeps,
  type AIRouterUseCases,
} from "#/interfaces/http/routes/ai/shared";

export interface AIHttpModuleConfig {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
  encryptionKey: string;
  repositories: {
    authorizationRepository: AuthorizationRepository;
    contentRepository: ContentRepository;
    playlistRepository: PlaylistRepository;
    scheduleRepository: ScheduleRepository;
    displayRepository: DisplayDbRepository;
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
  const credentialsRepository = new AICredentialsRepo();
  const pendingActionStore = new RedisPendingActionStore();
  const checkPermissionUseCase = new CheckPermissionUseCase({
    authorizationRepository: config.repositories.authorizationRepository,
  });

  // Noop audit logger - real auditing happens via the request-level audit trail middleware
  const auditLogger = {
    log(_input: {
      event: string;
      userId: string;
      metadata?: Record<string, unknown>;
    }) {
      // Audit trail is handled by the request-level middleware
    },
  };

  // Tool dependencies
  const createTextContentUseCase = new CreateTextContentUseCase({
    contentRepository: config.repositories.contentRepository,
    contentStorage: config.storage,
    userRepository: config.repositories.userRepository,
  });

  const createPlaylistUseCase = new CreatePlaylistUseCase({
    playlistRepository: config.repositories.playlistRepository,
    userRepository: config.repositories.userRepository,
  });

  const createScheduleUseCase = new CreateScheduleUseCase({
    scheduleRepository: config.repositories.scheduleRepository,
    playlistRepository: config.repositories.playlistRepository,
    displayRepository: config.repositories.displayRepository,
    contentRepository: config.repositories.contentRepository,
  });

  const toolExecutor = new AIToolExecutor({
    createTextContentUseCase,
    createPlaylistUseCase,
    createScheduleUseCase,
    pendingActionStore,
    auditLogger,
  });

  // Use cases
  const aiChat = new AIChatUseCase({
    credentialsRepository,
    encryptionService,
    toolExecutor,
    pendingActionStore,
    auditLogger,
    executeAIChat,
  });

  const aiConfirmAction = new AIConfirmActionUseCase({
    pendingActionStore,
    credentialsRepository,
    encryptionService,
    contentRepository: config.repositories.contentRepository,
    playlistRepository: config.repositories.playlistRepository,
    scheduleRepository: config.repositories.scheduleRepository,
    auditLogger,
  });

  const cancelPendingAction = new CancelPendingActionUseCase({
    pendingActionStore,
    auditLogger,
  });

  const listPendingActions = new ListPendingActionsUseCase({
    pendingActionStore,
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
      rateLimitWindowSeconds: 60,
      rateLimitMaxRequests: 20,
    },
    useCases: {
      aiChat,
      aiConfirmAction,
      cancelPendingAction,
      listPendingActions,
      storeCredential,
      listCredentials,
      deleteCredential,
    },
  };
};
