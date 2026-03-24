import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/errors/not-found";
import { assertDcismUserCannotModifyIdentity } from "#/application/guards/dcism-user.guard";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import { DuplicateEmailError, DuplicateUsernameError } from "../rbac/errors";

export interface UpdateCurrentUserProfileInput {
  userId: string;
  name?: string;
  timezone?: string | null;
  username?: string;
  email?: string | null;
}

export class UpdateCurrentUserProfileUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: UpdateCurrentUserProfileInput) {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

    const isAdmin = await this.deps.authorizationRepository.isAdminUser(
      input.userId,
    );
    assertDcismUserCannotModifyIdentity(
      { ...user, isAdmin },
      { username: input.username, email: input.email },
    );

    if (input.username) {
      const normalizedUsername = input.username.trim().toLowerCase();
      input = { ...input, username: normalizedUsername };
      if (normalizedUsername !== user.username) {
        throw new ForbiddenError("Cannot change your own username");
      }
      const existingByUsername =
        await this.deps.userRepository.findByUsername(normalizedUsername);
      if (existingByUsername && existingByUsername.id !== input.userId) {
        throw new DuplicateUsernameError();
      }
    }

    if (input.email) {
      const existingByEmail = await this.deps.userRepository.findByEmail(
        input.email,
      );
      if (existingByEmail && existingByEmail.id !== input.userId) {
        throw new DuplicateEmailError();
      }
    }

    const updated = await this.deps.userRepository.update(input.userId, {
      name: input.name,
      timezone: input.timezone,
      username: input.username,
      email: input.email,
    });
    if (!updated) throw new NotFoundError("User not found");
    return updated;
  }
}
