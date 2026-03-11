import {
  AcceptInvitationUseCase,
  AuthenticateUserUseCase,
  ChangeCurrentUserPasswordUseCase,
  CreateInvitationUseCase,
  ListInvitationsUseCase,
  RefreshSessionUseCase,
  ResendInvitationUseCase,
  SetCurrentUserAvatarUseCase,
  UpdateCurrentUserProfileUseCase,
} from "#/application/use-cases/auth";
import {
  CheckPermissionUseCase,
  DeleteCurrentUserUseCase,
} from "#/application/use-cases/rbac";
import {
  type AuthRouterDeps,
  type AuthRouterUseCases,
} from "#/interfaces/http/routes/auth/shared";

export interface AuthHttpModule {
  deps: AuthRouterDeps;
  useCases: AuthRouterUseCases;
}

export const createAuthHttpModule = (
  deps: Omit<
    AuthRouterDeps,
    | "changeCurrentUserPasswordUseCase"
    | "checkPermissionUseCase"
    | "deleteCurrentUserUseCase"
    | "setCurrentUserAvatarUseCase"
    | "updateCurrentUserProfileUseCase"
  >,
): AuthHttpModule => {
  const routerDeps: AuthRouterDeps = {
    ...deps,
    checkPermissionUseCase: new CheckPermissionUseCase({
      authorizationRepository: deps.authorizationRepository,
    }),
    deleteCurrentUserUseCase: new DeleteCurrentUserUseCase({
      userRepository: deps.userRepository,
    }),
    updateCurrentUserProfileUseCase: new UpdateCurrentUserProfileUseCase({
      userRepository: deps.userRepository,
    }),
    changeCurrentUserPasswordUseCase: new ChangeCurrentUserPasswordUseCase({
      userRepository: deps.userRepository,
      credentialsRepository: deps.credentialsRepository,
      passwordVerifier: deps.passwordVerifier,
      passwordHasher: deps.passwordHasher,
    }),
    setCurrentUserAvatarUseCase: new SetCurrentUserAvatarUseCase({
      userRepository: deps.userRepository,
      storage: deps.avatarStorage,
    }),
  };

  const createInvitation = new CreateInvitationUseCase({
    userRepository: routerDeps.userRepository,
    invitationRepository: routerDeps.invitationRepository,
    inviteTokenTtlSeconds: routerDeps.inviteTokenTtlSeconds,
    inviteAcceptBaseUrl: routerDeps.inviteAcceptBaseUrl,
  });

  return {
    deps: routerDeps,
    useCases: {
      authenticateUser: new AuthenticateUserUseCase({
        credentialsRepository: routerDeps.credentialsRepository,
        passwordVerifier: routerDeps.passwordVerifier,
        tokenIssuer: routerDeps.tokenIssuer,
        userRepository: routerDeps.userRepository,
        clock: routerDeps.clock,
        tokenTtlSeconds: routerDeps.tokenTtlSeconds,
        issuer: routerDeps.issuer,
        authSessionRepository: routerDeps.authSessionRepository,
      }),
      refreshSession: new RefreshSessionUseCase({
        tokenIssuer: routerDeps.tokenIssuer,
        userRepository: routerDeps.userRepository,
        clock: routerDeps.clock,
        tokenTtlSeconds: routerDeps.tokenTtlSeconds,
        issuer: routerDeps.issuer,
        authSessionRepository: routerDeps.authSessionRepository,
      }),
      createInvitation,
      acceptInvitation: new AcceptInvitationUseCase({
        invitationRepository: routerDeps.invitationRepository,
        userRepository: routerDeps.userRepository,
        passwordHasher: routerDeps.passwordHasher,
        credentialsRepository: routerDeps.credentialsRepository,
      }),
      listInvitations: new ListInvitationsUseCase({
        invitationRepository: routerDeps.invitationRepository,
      }),
      resendInvitation: new ResendInvitationUseCase({
        invitationRepository: routerDeps.invitationRepository,
        createInvitationUseCase: createInvitation,
      }),
    },
  };
};
