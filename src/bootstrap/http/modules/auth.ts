import {
  AcceptInvitationUseCase,
  AuthenticateUserUseCase,
  ChangeCurrentUserPasswordUseCase,
  CreateInvitationUseCase,
  ForgotPasswordUseCase,
  ListInvitationsUseCase,
  RefreshSessionUseCase,
  RequestEmailChangeUseCase,
  ResendInvitationUseCase,
  ResetPasswordUseCase,
  SetCurrentUserAvatarUseCase,
  UpdateCurrentUserProfileUseCase,
  VerifyEmailChangeUseCase,
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
    invitationEmailSender: routerDeps.invitationEmailSender,
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
      forgotPassword: new ForgotPasswordUseCase({
        userRepository: routerDeps.userRepository,
        passwordResetTokenRepository: routerDeps.passwordResetTokenRepository,
        passwordResetEmailSender: routerDeps.passwordResetEmailSender ?? {
          sendResetLink: async () => {},
        },
        resetPasswordBaseUrl:
          routerDeps.resetPasswordBaseUrl ??
          "http://localhost:3000/reset-password",
      }),
      resetPassword: new ResetPasswordUseCase({
        passwordResetTokenRepository: routerDeps.passwordResetTokenRepository,
        credentialsRepository: routerDeps.credentialsRepository,
        passwordHasher: routerDeps.passwordHasher,
        userRepository: routerDeps.userRepository,
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
      requestEmailChange: new RequestEmailChangeUseCase({
        userRepository: routerDeps.userRepository,
        emailChangeTokenRepository: routerDeps.emailChangeTokenRepository ?? {
          store: async () => {},
          findByHashedToken: async () => null,
          findPendingByUserId: async () => null,
          consumeByHashedToken: async () => {},
          deleteByUserId: async () => {},
          deleteExpired: async () => {},
        },
        emailChangeVerificationEmailSender:
          routerDeps.emailChangeVerificationEmailSender ?? {
            sendVerificationLink: async () => {},
          },
        emailChangeTokenTtlSeconds:
          routerDeps.emailChangeTokenTtlSeconds ?? 60 * 60 * 24,
        emailChangeVerifyBaseUrl:
          routerDeps.emailChangeVerifyBaseUrl ??
          "http://localhost:3000/verify-email-change",
      }),
      verifyEmailChange: new VerifyEmailChangeUseCase({
        userRepository: routerDeps.userRepository,
        emailChangeTokenRepository: routerDeps.emailChangeTokenRepository ?? {
          store: async () => {},
          findByHashedToken: async () => null,
          findPendingByUserId: async () => null,
          consumeByHashedToken: async () => {},
          deleteByUserId: async () => {},
          deleteExpired: async () => {},
        },
      }),
    },
  };
};
