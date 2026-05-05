import {
  ActivateGlobalEmergencyUseCase,
  ClaimRegistrationLinkUseCase,
  CloseDisplayRegistrationAttemptUseCase,
  CreateDisplayGroupUseCase,
  CreateDisplayRegistrationSessionUseCase,
  DeactivateGlobalEmergencyUseCase,
  DeleteDisplayGroupUseCase,
  GetDisplayManifestUseCase,
  GetDisplayPreviewUseCase,
  GetDisplayUseCase,
  GetRuntimeOverridesUseCase,
  IssueDisplayRegistrationAttemptUseCase,
  IssueRegistrationLinkUseCase,
  ListDisplayGroupsUseCase,
  ListDisplayOptionsUseCase,
  ListDisplayOutputOptionsUseCase,
  ListDisplaysUseCase,
  RegisterDisplayUseCase,
  RequestDisplayRefreshUseCase,
  RotateDisplayRegistrationAttemptUseCase,
  SetDisplayGroupsUseCase,
  UnregisterDisplayUseCase,
  UpdateDisplayGroupUseCase,
  UpdateDisplayUseCase,
} from "#/application/use-cases/displays";
import {
  ClearEmergencySlotUseCase,
  ListEmergencySlotsUseCase,
  SetEmergencySlotUseCase,
} from "#/application/use-cases/emergency-slots";
import { CheckPermissionUseCase } from "#/application/use-cases/rbac";
import {
  type DisplaysRouterDeps,
  type DisplaysRouterUseCases,
} from "#/interfaces/http/routes/displays/module";

export interface DisplaysHttpModule {
  deps: DisplaysRouterDeps;
  useCases: DisplaysRouterUseCases;
}

export const createDisplaysHttpModule = (
  deps: Omit<DisplaysRouterDeps, "checkPermissionUseCase">,
): DisplaysHttpModule => {
  const routerDeps: DisplaysRouterDeps = {
    ...deps,
    checkPermissionUseCase: new CheckPermissionUseCase({
      authorizationRepository: deps.repositories.authorizationRepository,
    }),
  };

  return {
    deps: routerDeps,
    useCases: {
      listDisplays: new ListDisplaysUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
      }),
      listDisplayOptions: new ListDisplayOptionsUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
      }),
      listDisplayOutputOptions: new ListDisplayOutputOptionsUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
      }),
      getDisplay: new GetDisplayUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
      }),
      getDisplayManifest: new GetDisplayManifestUseCase({
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        playlistRepository: routerDeps.repositories.playlistRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        contentStorage: deps.storage,
        displayRepository: routerDeps.repositories.displayRepository,
        runtimeControlRepository:
          routerDeps.repositories.runtimeControlRepository,
        emergencySlotRepository:
          routerDeps.repositories.emergencySlotRepository,
        downloadUrlExpiresInSeconds: routerDeps.downloadUrlExpiresInSeconds,
        scheduleTimeZone: routerDeps.scheduleTimeZone,
      }),
      updateDisplay: new UpdateDisplayUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
      }),
      activateGlobalEmergency: new ActivateGlobalEmergencyUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        runtimeControlRepository:
          routerDeps.repositories.runtimeControlRepository,
        emergencySlotRepository:
          routerDeps.repositories.emergencySlotRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
      }),
      deactivateGlobalEmergency: new DeactivateGlobalEmergencyUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
        runtimeControlRepository:
          routerDeps.repositories.runtimeControlRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
      }),
      getRuntimeOverrides: new GetRuntimeOverridesUseCase({
        runtimeControlRepository:
          routerDeps.repositories.runtimeControlRepository,
      }),
      requestDisplayRefresh: new RequestDisplayRefreshUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
      }),
      unregisterDisplay: new UnregisterDisplayUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
        displayKeyRepository: routerDeps.repositories.displayKeyRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
        lifecycleEventPublisher: routerDeps.lifecycleEventPublisher,
      }),
      listDisplayGroups: new ListDisplayGroupsUseCase({
        displayGroupRepository: routerDeps.repositories.displayGroupRepository,
      }),
      createDisplayGroup: new CreateDisplayGroupUseCase({
        displayGroupRepository: routerDeps.repositories.displayGroupRepository,
      }),
      updateDisplayGroup: new UpdateDisplayGroupUseCase({
        displayGroupRepository: routerDeps.repositories.displayGroupRepository,
      }),
      deleteDisplayGroup: new DeleteDisplayGroupUseCase({
        displayGroupRepository: routerDeps.repositories.displayGroupRepository,
      }),
      setDisplayGroups: new SetDisplayGroupsUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
        displayGroupRepository: routerDeps.repositories.displayGroupRepository,
      }),
      issueDisplayRegistrationAttempt:
        new IssueDisplayRegistrationAttemptUseCase({
          displayPairingCodeRepository:
            deps.repositories.displayPairingCodeRepository,
          registrationAttemptStore: deps.registrationAttemptStore,
        }),
      rotateDisplayRegistrationAttempt:
        new RotateDisplayRegistrationAttemptUseCase({
          displayPairingCodeRepository:
            deps.repositories.displayPairingCodeRepository,
          registrationAttemptStore: deps.registrationAttemptStore,
        }),
      closeDisplayRegistrationAttempt:
        new CloseDisplayRegistrationAttemptUseCase({
          displayPairingCodeRepository:
            deps.repositories.displayPairingCodeRepository,
          registrationAttemptStore: deps.registrationAttemptStore,
        }),
      createDisplayRegistrationSession:
        new CreateDisplayRegistrationSessionUseCase({
          displayPairingCodeRepository:
            deps.repositories.displayPairingCodeRepository,
          displayPairingSessionRepository:
            deps.repositories.displayPairingSessionRepository,
          registrationAttemptStore: deps.registrationAttemptStore,
        }),
      registerDisplay: new RegisterDisplayUseCase({
        displayPairingSessionRepository:
          deps.repositories.displayPairingSessionRepository,
        displayRepository: deps.repositories.displayRepository,
        displayKeyRepository: deps.repositories.displayKeyRepository,
        registrationAttemptStore: deps.registrationAttemptStore,
        registrationAttemptEventPublisher:
          deps.registrationAttemptEventPublisher,
        lifecycleEventPublisher: deps.lifecycleEventPublisher,
      }),
      issueRegistrationLink: new IssueRegistrationLinkUseCase({
        registrationLinkStore: deps.registrationLinkStore,
        registrationAttemptStore: deps.registrationAttemptStore,
        displayPairingCodeRepository:
          deps.repositories.displayPairingCodeRepository,
        displayRepository: deps.repositories.displayRepository,
      }),
      claimRegistrationLink: new ClaimRegistrationLinkUseCase({
        registrationLinkStore: deps.registrationLinkStore,
        displayRepository: deps.repositories.displayRepository,
        displayKeyRepository: deps.repositories.displayKeyRepository,
        displayGroupRepository: deps.repositories.displayGroupRepository,
        registrationAttemptStore: deps.registrationAttemptStore,
        registrationAttemptEventPublisher:
          deps.registrationAttemptEventPublisher,
        lifecycleEventPublisher: deps.lifecycleEventPublisher,
      }),
      getDisplayPreview: new GetDisplayPreviewUseCase({
        displayRepository: deps.repositories.displayRepository,
        displayPreviewRepository: deps.repositories.displayPreviewRepository,
      }),
      listEmergencySlots: new ListEmergencySlotsUseCase({
        emergencySlotRepository: deps.repositories.emergencySlotRepository,
        contentRepository: deps.repositories.contentRepository,
      }),
      setEmergencySlot: new SetEmergencySlotUseCase({
        emergencySlotRepository: deps.repositories.emergencySlotRepository,
        contentRepository: deps.repositories.contentRepository,
      }),
      clearEmergencySlot: new ClearEmergencySlotUseCase({
        emergencySlotRepository: deps.repositories.emergencySlotRepository,
      }),
    },
  };
};
