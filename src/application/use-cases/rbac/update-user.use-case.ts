import { ForbiddenError } from "#/application/errors/forbidden";
import { assertDcismUserCannotModifyIdentity } from "#/application/guards/dcism-user.guard";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  DuplicateEmailError,
  DuplicateUsernameError,
  NotFoundError,
} from "./errors";

async function ensureCallerCanModifyAdminUser(
  deps: {
    authorizationRepository: AuthorizationRepository;
  },
  targetUserId: string,
  callerUserId: string | undefined,
  forbiddenMessage: string,
): Promise<void> {
  const targetIsAdmin =
    await deps.authorizationRepository.isAdminUser(targetUserId);
  if (!targetIsAdmin) return;

  if (callerUserId === undefined) {
    throw new ForbiddenError(forbiddenMessage);
  }

  const callerIsAdmin =
    await deps.authorizationRepository.isAdminUser(callerUserId);
  if (!callerIsAdmin) {
    throw new ForbiddenError(forbiddenMessage);
  }
}

export class UpdateUserUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: {
    id: string;
    username?: string;
    email?: string | null;
    name?: string;
    isActive?: boolean;
    callerUserId?: string;
  }) {
    await ensureCallerCanModifyAdminUser(
      this.deps,
      input.id,
      input.callerUserId,
      "Cannot modify an Admin user",
    );

    const targetUser = await this.deps.userRepository.findById(input.id);
    if (!targetUser) throw new NotFoundError("User not found");

    const targetIsAdmin = await this.deps.authorizationRepository.isAdminUser(
      input.id,
    );
    assertDcismUserCannotModifyIdentity(
      { ...targetUser, isAdmin: targetIsAdmin },
      {
        username: input.username,
        email: input.email,
      },
    );

    if (input.username) {
      const existingByUsername = await this.deps.userRepository.findByUsername(
        input.username,
      );
      if (existingByUsername && existingByUsername.id !== input.id) {
        throw new DuplicateUsernameError();
      }
    }
    if (input.email) {
      const existingByEmail = await this.deps.userRepository.findByEmail(
        input.email,
      );
      if (existingByEmail && existingByEmail.id !== input.id) {
        throw new DuplicateEmailError();
      }
    }

    const user = await this.deps.userRepository.update(input.id, {
      username: input.username,
      email: input.email,
      name: input.name,
      isActive: input.isActive,
    });
    if (!user) throw new NotFoundError("User not found");
    return user;
  }
}
