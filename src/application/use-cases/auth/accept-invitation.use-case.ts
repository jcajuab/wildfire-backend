import { ValidationError } from "#/application/errors/validation";
import {
  type CredentialsRepository,
  type InvitationRepository,
  type PasswordHasher,
} from "#/application/ports/auth";
import { type UserRepository } from "#/application/ports/rbac";
import {
  DEFAULT_INVITE_NAME,
  hashToken,
} from "#/application/use-cases/auth/create-invitation.use-case";

const deriveNameFromEmail = (email: string): string => {
  const localPart = email.split("@")[0]?.trim();
  if (!localPart) return DEFAULT_INVITE_NAME;
  return localPart;
};

export class AcceptInvitationUseCase {
  constructor(
    private readonly deps: {
      invitationRepository: InvitationRepository;
      userRepository: UserRepository;
      passwordHasher: PasswordHasher;
      credentialsRepository: CredentialsRepository;
    },
  ) {}

  async execute(input: {
    token: string;
    password: string;
    name?: string | null;
  }): Promise<void> {
    const now = new Date();
    const invitation =
      await this.deps.invitationRepository.findActiveByHashedToken(
        hashToken(input.token),
        now,
      );

    if (!invitation) {
      throw new ValidationError("Invitation token is invalid or expired.");
    }

    const existingUser = await this.deps.userRepository.findByEmail(
      invitation.email,
    );
    if (existingUser) {
      throw new ValidationError("A user with this email already exists.");
    }

    if (!this.deps.credentialsRepository.createPasswordHash) {
      throw new ValidationError("Invitation acceptance is not configured.");
    }

    const passwordHash = await this.deps.passwordHasher.hash(input.password);
    const createdUser = await this.deps.userRepository.create({
      email: invitation.email,
      name:
        input.name?.trim() ||
        invitation.name ||
        deriveNameFromEmail(invitation.email),
      isActive: true,
    });

    await this.deps.credentialsRepository.createPasswordHash(
      createdUser.email,
      passwordHash,
    );
    await this.deps.invitationRepository.markAccepted(invitation.id, now);
  }
}
