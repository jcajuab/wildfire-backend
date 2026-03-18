import { ForbiddenError } from "#/application/errors/forbidden";
import { assertNotDcismUser } from "#/application/guards/dcism-user.guard";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import { NotFoundError } from "./errors";

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

export class DeleteUserUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: { id: string; callerUserId?: string }) {
    await ensureCallerCanModifyAdminUser(
      this.deps,
      input.id,
      input.callerUserId,
      "Cannot delete an Admin user",
    );

    const user = await this.deps.userRepository.findById(input.id);
    if (!user) throw new NotFoundError("User not found");

    const targetIsAdmin = await this.deps.authorizationRepository.isAdminUser(
      user.id,
    );
    assertNotDcismUser(
      { ...user, isAdmin: targetIsAdmin },
      "Cannot delete a DCISM user. DCISM users are managed by the HTSHADOW file.",
    );

    const deleted = await this.deps.userRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("User not found");
  }
}

/** Deletes the current user (self-deletion). Auth only; no permission check. */
export class DeleteCurrentUserUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      authorizationRepository: AuthorizationRepository;
    },
  ) {}

  async execute(input: { userId: string }) {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

    const isAdmin = await this.deps.authorizationRepository.isAdminUser(
      user.id,
    );
    assertNotDcismUser(
      { ...user, isAdmin },
      "DCISM users cannot delete their account.",
    );

    await this.deps.userRepository.delete(input.userId);
  }
}
