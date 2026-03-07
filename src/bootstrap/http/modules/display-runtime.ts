import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type DisplayAuthNonceRepository,
  type DisplayKeyRepository,
} from "#/application/ports/display-auth";
import {
  type AdminDisplayLifecycleEventPublisher,
  type DisplayStreamEventPublisher,
  type DisplayStreamEventSubscription,
} from "#/application/ports/display-stream-events";
import {
  type DisplayPreviewRepository,
  type DisplayRepository,
} from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type RuntimeControlRepository } from "#/application/ports/runtime-controls";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  AuthorizeSignedDisplayRequestUseCase,
  GetDisplayManifestUseCase,
  IssueDisplayAuthChallengeUseCase,
  RecordDisplayHeartbeatUseCase,
  StoreDisplaySnapshotUseCase,
  VerifyDisplayAuthChallengeUseCase,
} from "#/application/use-cases/displays";
import {
  type DisplayRuntimeRouterDeps,
  type DisplayRuntimeRouterModule,
} from "#/interfaces/http/routes/display-runtime";
import { type AuthSecurityStore } from "#/interfaces/http/security/redis-auth-security.store";

interface CreateDisplayRuntimeHttpModuleDeps extends DisplayRuntimeRouterDeps {
  jwtSecret: string;
  downloadUrlExpiresInSeconds: number;
  scheduleTimeZone?: string;
  repositories: {
    displayRepository: DisplayRepository;
    scheduleRepository: ScheduleRepository;
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    runtimeControlRepository: RuntimeControlRepository;
    displayKeyRepository: DisplayKeyRepository;
    displayAuthNonceRepository: DisplayAuthNonceRepository;
    displayPreviewRepository: DisplayPreviewRepository;
  };
  storage: ContentStorage;
  defaultEmergencyContentId?: string;
  displayEventPublisher: DisplayStreamEventPublisher;
  lifecycleEventPublisher: AdminDisplayLifecycleEventPublisher;
  displayEventSubscription: DisplayStreamEventSubscription;
  authSecurityStore: AuthSecurityStore;
}

export const createDisplayRuntimeHttpModule = (
  deps: CreateDisplayRuntimeHttpModuleDeps,
): DisplayRuntimeRouterModule => {
  return {
    deps: {
      authSecurityStore: deps.authSecurityStore,
      rateLimits: deps.rateLimits,
      trustProxyHeaders: deps.trustProxyHeaders,
      displayEventSubscription: deps.displayEventSubscription,
      lifecycleEventPublisher: deps.lifecycleEventPublisher,
    },
    useCases: {
      issueDisplayAuthChallenge: new IssueDisplayAuthChallengeUseCase({
        displayRepository: deps.repositories.displayRepository,
        displayKeyRepository: deps.repositories.displayKeyRepository,
        jwtSecret: deps.jwtSecret,
      }),
      verifyDisplayAuthChallenge: new VerifyDisplayAuthChallengeUseCase({
        displayRepository: deps.repositories.displayRepository,
        displayKeyRepository: deps.repositories.displayKeyRepository,
        jwtSecret: deps.jwtSecret,
      }),
      authorizeSignedDisplayRequest: new AuthorizeSignedDisplayRequestUseCase({
        displayRepository: deps.repositories.displayRepository,
        displayKeyRepository: deps.repositories.displayKeyRepository,
        displayAuthNonceRepository:
          deps.repositories.displayAuthNonceRepository,
      }),
      getDisplayManifest: new GetDisplayManifestUseCase({
        scheduleRepository: deps.repositories.scheduleRepository,
        playlistRepository: deps.repositories.playlistRepository,
        contentRepository: deps.repositories.contentRepository,
        contentStorage: deps.storage,
        displayRepository: deps.repositories.displayRepository,
        runtimeControlRepository: deps.repositories.runtimeControlRepository,
        downloadUrlExpiresInSeconds: deps.downloadUrlExpiresInSeconds,
        scheduleTimeZone: deps.scheduleTimeZone,
        defaultEmergencyContentId: deps.defaultEmergencyContentId,
      }),
      storeDisplaySnapshot: new StoreDisplaySnapshotUseCase({
        displayPreviewRepository: deps.repositories.displayPreviewRepository,
      }),
      recordDisplayHeartbeat: new RecordDisplayHeartbeatUseCase({
        displayRepository: deps.repositories.displayRepository,
        scheduleRepository: deps.repositories.scheduleRepository,
        displayEventPublisher: deps.displayEventPublisher,
        lifecycleEventPublisher: deps.lifecycleEventPublisher,
        scheduleTimeZone: deps.scheduleTimeZone,
      }),
    },
  };
};
