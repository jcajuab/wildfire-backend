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

const normalizeUsername = (value: string): string => value.trim().toLowerCase();

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
    username: string;
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

    const username = normalizeUsername(input.username);
    if (!username) {
      throw new ValidationError("Username is required.");
    }

    const existingUser = await this.deps.userRepository.findByEmail(
      invitation.email,
    );
    if (existingUser) {
      throw new ValidationError("A user with this email already exists.");
    }
    const existingByUsername =
      await this.deps.userRepository.findByUsername(username);
    if (existingByUsername) {
      throw new ValidationError("A user with this username already exists.");
    }

    if (!this.deps.credentialsRepository.createPasswordHash) {
      throw new ValidationError("Invitation acceptance is not configured.");
    }

    const passwordHash = await this.deps.passwordHasher.hash(input.password);
    const createdUser = await this.deps.userRepository.create({
      username,
      email: invitation.email,
      name:
        input.name?.trim() ||
        invitation.name ||
        deriveNameFromEmail(invitation.email),
      isActive: true,
      invitedAt: now,
    });

    await this.deps.credentialsRepository.createPasswordHash(
      createdUser.username,
      passwordHash,
    );
    await this.deps.invitationRepository.markAccepted(invitation.id, now);
  }
}
