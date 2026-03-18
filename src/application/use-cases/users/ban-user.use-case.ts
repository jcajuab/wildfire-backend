import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/errors/not-found";
import { type AuthSessionRepository } from "#/application/ports/auth";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";

export class BanUserUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      authSessionRepository: AuthSessionRepository;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: { id: string; callerUserId: string }): Promise<void> {
    const callerIsAdmin = await this.deps.authorizationRepository.isAdminUser(
      input.callerUserId,
    );
    if (!callerIsAdmin) {
      throw new ForbiddenError("Only administrators can ban users.");
    }

    const user = await this.deps.userRepository.findById(input.id);
    if (!user) throw new NotFoundError("User not found");

    await this.deps.userRepository.update(input.id, { bannedAt: new Date() });
    await this.deps.authSessionRepository.revokeAllForUser(input.id);
  }
}

export class UnbanUserUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: { id: string; callerUserId: string }): Promise<void> {
    const callerIsAdmin = await this.deps.authorizationRepository.isAdminUser(
      input.callerUserId,
    );
    if (!callerIsAdmin) {
      throw new ForbiddenError("Only administrators can unban users.");
    }

    const user = await this.deps.userRepository.findById(input.id);
    if (!user) throw new NotFoundError("User not found");

    await this.deps.userRepository.update(input.id, { bannedAt: null });
  }
}
