import {
  ActivateGlobalEmergencyUseCase,
  CloseDisplayRegistrationAttemptUseCase,
  CreateDisplayGroupUseCase,
  CreateDisplayRegistrationSessionUseCase,
  DeactivateGlobalEmergencyUseCase,
  DeleteDisplayGroupUseCase,
  GetDisplayPreviewUseCase,
  GetDisplayUseCase,
  GetRuntimeOverridesUseCase,
  IssueDisplayRegistrationAttemptUseCase,
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
        displayGroupRepository: routerDeps.repositories.displayGroupRepository,
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        playlistRepository: routerDeps.repositories.playlistRepository,
        scheduleTimeZone: routerDeps.scheduleTimeZone,
      }),
      listDisplayOptions: new ListDisplayOptionsUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
      }),
      listDisplayOutputOptions: new ListDisplayOutputOptionsUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
      }),
      getDisplay: new GetDisplayUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        playlistRepository: routerDeps.repositories.playlistRepository,
        scheduleTimeZone: routerDeps.scheduleTimeZone,
      }),
      updateDisplay: new UpdateDisplayUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
        scheduleRepository: routerDeps.repositories.scheduleRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        scheduleTimeZone: routerDeps.scheduleTimeZone,
      }),
      activateGlobalEmergency: new ActivateGlobalEmergencyUseCase({
        displayRepository: routerDeps.repositories.displayRepository,
        contentRepository: routerDeps.repositories.contentRepository,
        runtimeControlRepository:
          routerDeps.repositories.runtimeControlRepository,
        displayEventPublisher: routerDeps.displayEventPublisher,
        defaultEmergencyContentId: routerDeps.defaultEmergencyContentId,
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
      getDisplayPreview: new GetDisplayPreviewUseCase({
        displayRepository: deps.repositories.displayRepository,
        displayPreviewRepository: deps.repositories.displayPreviewRepository,
      }),
    },
  };
};
