import { type Hono } from "hono";
import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type DisplayKeyRepository,
  type DisplayPairingSessionRepository,
} from "#/application/ports/display-auth";
import { type DisplayPairingCodeRepository } from "#/application/ports/display-pairing";
import {
  type DisplayRegistrationAttemptEventPublisher,
  type DisplayRegistrationAttemptEventSubscription,
  type DisplayRegistrationAttemptStore,
} from "#/application/ports/display-registration-attempt";
import { type DisplayRegistrationLinkStore } from "#/application/ports/display-registration-link";
import {
  type AdminDisplayLifecycleEventPublisher,
  type AdminDisplayLifecycleEventSubscription,
  type DisplayStreamEventPublisher,
} from "#/application/ports/display-stream-events";
import {
  type DisplayGroupRepository,
  type DisplayPreviewRepository,
  type DisplayRepository,
} from "#/application/ports/displays";
import { type EmergencySlotRepository } from "#/application/ports/emergency-slots";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type AuthorizationRepository } from "#/application/ports/rbac";
import { type RuntimeControlRepository } from "#/application/ports/runtime-controls";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  type ActivateGlobalEmergencyUseCase,
  type ClaimRegistrationLinkUseCase,
  type CloseDisplayRegistrationAttemptUseCase,
  type CreateDisplayGroupUseCase,
  type CreateDisplayRegistrationSessionUseCase,
  type DeactivateGlobalEmergencyUseCase,
  type DeleteDisplayGroupUseCase,
  type GetDisplayManifestUseCase,
  type GetDisplayPreviewUseCase,
  type GetDisplayUseCase,
  type GetRuntimeOverridesUseCase,
  type IssueDisplayRegistrationAttemptUseCase,
  type IssueRegistrationLinkUseCase,
  type ListDisplayGroupsUseCase,
  type ListDisplayOptionsUseCase,
  type ListDisplayOutputOptionsUseCase,
  type ListDisplaysUseCase,
  type RegisterDisplayUseCase,
  type RequestDisplayRefreshUseCase,
  type ResolveDisplayGroupsUseCase,
  type RotateDisplayRegistrationAttemptUseCase,
  type SearchDisplayGroupsUseCase,
  type SetDisplayGroupsUseCase,
  type UnregisterDisplayUseCase,
  type UpdateDisplayGroupUseCase,
  type UpdateDisplayUseCase,
} from "#/application/use-cases/displays";
import {
  type ClearEmergencySlotUseCase,
  type ListEmergencySlotsUseCase,
  type SetEmergencySlotUseCase,
} from "#/application/use-cases/emergency-slots";
import { type CheckPermissionUseCase } from "#/application/use-cases/rbac";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { type AuthorizePermission } from "#/interfaces/http/routes/shared/error-handling";

export interface DisplaysRouterDeps {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
  downloadUrlExpiresInSeconds: number;
  scheduleTimeZone?: string;
  repositories: {
    displayRepository: DisplayRepository;
    scheduleRepository: ScheduleRepository;
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    runtimeControlRepository: RuntimeControlRepository;
    emergencySlotRepository: EmergencySlotRepository;
    authorizationRepository: AuthorizationRepository;
    displayGroupRepository: DisplayGroupRepository;
    displayPairingCodeRepository: DisplayPairingCodeRepository;
    displayPairingSessionRepository: DisplayPairingSessionRepository;
    displayKeyRepository: DisplayKeyRepository;
    displayPreviewRepository: DisplayPreviewRepository;
  };
  storage: ContentStorage;
  registrationAttemptStore: DisplayRegistrationAttemptStore;
  registrationLinkStore: DisplayRegistrationLinkStore;
  displayEventPublisher: DisplayStreamEventPublisher;
  lifecycleEventPublisher: AdminDisplayLifecycleEventPublisher;
  lifecycleEventSubscription: AdminDisplayLifecycleEventSubscription;
  registrationAttemptEventPublisher: DisplayRegistrationAttemptEventPublisher;
  registrationAttemptEventSubscription: DisplayRegistrationAttemptEventSubscription;
  checkPermissionUseCase: CheckPermissionUseCase;
}

export interface DisplaysRouterUseCases {
  listDisplays: ListDisplaysUseCase;
  listDisplayOptions: ListDisplayOptionsUseCase;
  listDisplayOutputOptions: ListDisplayOutputOptionsUseCase;
  getDisplay: GetDisplayUseCase;
  getDisplayManifest: GetDisplayManifestUseCase;
  updateDisplay: UpdateDisplayUseCase;
  listDisplayGroups: ListDisplayGroupsUseCase;
  searchDisplayGroups: SearchDisplayGroupsUseCase;
  resolveDisplayGroups: ResolveDisplayGroupsUseCase;
  createDisplayGroup: CreateDisplayGroupUseCase;
  updateDisplayGroup: UpdateDisplayGroupUseCase;
  deleteDisplayGroup: DeleteDisplayGroupUseCase;
  setDisplayGroups: SetDisplayGroupsUseCase;
  requestDisplayRefresh: RequestDisplayRefreshUseCase;
  unregisterDisplay: UnregisterDisplayUseCase;
  activateGlobalEmergency: ActivateGlobalEmergencyUseCase;
  deactivateGlobalEmergency: DeactivateGlobalEmergencyUseCase;
  getRuntimeOverrides: GetRuntimeOverridesUseCase;
  issueDisplayRegistrationAttempt: IssueDisplayRegistrationAttemptUseCase;
  rotateDisplayRegistrationAttempt: RotateDisplayRegistrationAttemptUseCase;
  closeDisplayRegistrationAttempt: CloseDisplayRegistrationAttemptUseCase;
  createDisplayRegistrationSession: CreateDisplayRegistrationSessionUseCase;
  registerDisplay: RegisterDisplayUseCase;
  issueRegistrationLink: IssueRegistrationLinkUseCase;
  claimRegistrationLink: ClaimRegistrationLinkUseCase;
  getDisplayPreview: GetDisplayPreviewUseCase;
  listEmergencySlots: ListEmergencySlotsUseCase;
  setEmergencySlot: SetEmergencySlotUseCase;
  clearEmergencySlot: ClearEmergencySlotUseCase;
}

export type DisplaysRouter = Hono<{ Variables: JwtUserVariables }>;

export type { AuthorizePermission };
