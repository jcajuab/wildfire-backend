import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/errors/not-found";
import {
  type CredentialsRepository,
  type PasswordHasher,
} from "#/application/ports/auth";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";

const GENERATED_PASSWORD_BYTES = 16;

const generateRandomPassword = (): string => {
  const bytes = crypto.getRandomValues(
    new Uint8Array(GENERATED_PASSWORD_BYTES),
  );
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export class AdminResetPasswordUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      credentialsRepository: CredentialsRepository;
      passwordHasher: PasswordHasher;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: {
    id: string;
    callerUserId: string;
  }): Promise<{ plainPassword: string }> {
    const callerIsAdmin = this.deps.authorizationRepository.isAdminUser
      ? await this.deps.authorizationRepository.isAdminUser(input.callerUserId)
      : false;
    if (!callerIsAdmin) {
      throw new ForbiddenError("Only administrators can reset user passwords.");
    }

    const user = await this.deps.userRepository.findById(input.id);
    if (!user) throw new NotFoundError("User not found");

    if (user.invitedAt == null) {
      throw new ForbiddenError(
        "Password reset is only available for invited users.",
      );
    }

    const plainPassword = generateRandomPassword();
    const passwordHash = await this.deps.passwordHasher.hash(plainPassword);
    await this.deps.credentialsRepository.updatePasswordHash(
      user.username,
      passwordHash,
    );

    return { plainPassword };
  }
}
