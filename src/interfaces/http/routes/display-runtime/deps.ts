import {
  type AdminDisplayLifecycleEventPublisher,
  type DisplayStreamEventSubscription,
} from "#/application/ports/display-stream-events";
import {
  type AuthorizeSignedDisplayRequestUseCase,
  type GetDisplayManifestUseCase,
  type IssueDisplayAuthChallengeUseCase,
  type RecordDisplayHeartbeatUseCase,
  type StoreDisplaySnapshotUseCase,
  type VerifyDisplayAuthChallengeUseCase,
} from "#/application/use-cases/displays";
import { type AuthSecurityStore } from "#/interfaces/http/security/redis-auth-security.store";

export interface DisplayRuntimeRouterDeps {
  authSecurityStore: AuthSecurityStore;
  rateLimits: {
    windowSeconds: number;
    authChallengeMaxAttempts: number;
    authVerifyMaxAttempts: number;
  };
  trustProxyHeaders: boolean;
  displayEventSubscription: DisplayStreamEventSubscription;
  lifecycleEventPublisher: AdminDisplayLifecycleEventPublisher;
}

export interface DisplayRuntimeRouterUseCases {
  issueDisplayAuthChallenge: IssueDisplayAuthChallengeUseCase;
  verifyDisplayAuthChallenge: VerifyDisplayAuthChallengeUseCase;
  authorizeSignedDisplayRequest: AuthorizeSignedDisplayRequestUseCase;
  getDisplayManifest: GetDisplayManifestUseCase;
  storeDisplaySnapshot: StoreDisplaySnapshotUseCase;
  recordDisplayHeartbeat: RecordDisplayHeartbeatUseCase;
}

export interface DisplayRuntimeRouterModule {
  deps: DisplayRuntimeRouterDeps;
  useCases: DisplayRuntimeRouterUseCases;
}

export type DisplayVars = {
  displayId: string;
};
