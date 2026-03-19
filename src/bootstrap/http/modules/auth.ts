import {
  AcceptInvitationUseCase,
  AuthenticateUserUseCase,
  ChangeCurrentUserPasswordUseCase,
  CreateInvitationUseCase,
  ListInvitationsUseCase,
  RefreshSessionUseCase,
  ResendInvitationUseCase,
  RevealInvitationLinkUseCase,
  SetCurrentUserAvatarUseCase,
  UpdateCurrentUserProfileUseCase,
} from "#/application/use-cases/auth";
import {
  CheckPermissionUseCase,
  DeleteCurrentUserUseCase,
} from "#/application/use-cases/rbac";
import { AIKeyEncryptionService } from "#/infrastructure/crypto/ai-key-encryption.service";
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
  > & { inviteEncryptionKey: string },
): AuthHttpModule => {
  const routerDeps: AuthRouterDeps = {
    ...deps,
    checkPermissionUseCase: new CheckPermissionUseCase({
      authorizationRepository: deps.authorizationRepository,
    }),
    deleteCurrentUserUseCase: new DeleteCurrentUserUseCase({
      userRepository: deps.userRepository,
      authorizationRepository: deps.authorizationRepository,
    }),
    updateCurrentUserProfileUseCase: new UpdateCurrentUserProfileUseCase({
      userRepository: deps.userRepository,
      authorizationRepository: deps.authorizationRepository,
    }),
    changeCurrentUserPasswordUseCase: new ChangeCurrentUserPasswordUseCase({
      userRepository: deps.userRepository,
      credentialsRepository: deps.dbCredentialsRepository,
      passwordVerifier: deps.passwordVerifier,
      passwordHasher: deps.passwordHasher,
      authorizationRepository: deps.authorizationRepository,
    }),
    setCurrentUserAvatarUseCase: new SetCurrentUserAvatarUseCase({
      userRepository: deps.userRepository,
      storage: deps.avatarStorage,
    }),
  };

  const inviteEncryptionService = new AIKeyEncryptionService(
    Buffer.from(deps.inviteEncryptionKey, "hex"),
  );

  const createInvitation = new CreateInvitationUseCase({
    userRepository: routerDeps.userRepository,
    invitationRepository: routerDeps.invitationRepository,
    inviteTokenTtlSeconds: routerDeps.inviteTokenTtlSeconds,
    inviteAcceptBaseUrl: routerDeps.inviteAcceptBaseUrl,
    encryptionService: inviteEncryptionService,
  });

  return {
    deps: routerDeps,
    useCases: {
      authenticateUser: new AuthenticateUserUseCase({
        dbCredentialsRepository: routerDeps.dbCredentialsRepository,
        htshadowCredentialsReader: routerDeps.credentialsRepository,
        passwordVerifier: routerDeps.passwordVerifier,
        tokenIssuer: routerDeps.tokenIssuer,
        userRepository: routerDeps.userRepository,
        authorizationRepository: routerDeps.authorizationRepository,
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
        credentialsRepository: routerDeps.dbCredentialsRepository,
      }),
      listInvitations: new ListInvitationsUseCase({
        invitationRepository: routerDeps.invitationRepository,
      }),
      resendInvitation: new ResendInvitationUseCase({
        invitationRepository: routerDeps.invitationRepository,
        createInvitationUseCase: createInvitation,
      }),
      revealInvitationLink: new RevealInvitationLinkUseCase({
        invitationRepository: routerDeps.invitationRepository,
        encryptionService: inviteEncryptionService,
        inviteAcceptBaseUrl: routerDeps.inviteAcceptBaseUrl,
      }),
    },
  };
};
