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
  const targetIsAdmin = deps.authorizationRepository.isAdminUser
    ? await deps.authorizationRepository.isAdminUser(targetUserId)
    : false;
  if (!targetIsAdmin) return;

  if (callerUserId === undefined) {
    throw new ForbiddenError(forbiddenMessage);
  }

  const callerIsAdmin = deps.authorizationRepository.isAdminUser
    ? await deps.authorizationRepository.isAdminUser(callerUserId)
    : false;
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

    assertNotDcismUser(
      user,
      "Cannot delete a DCISM user. DCISM users are managed by the HTSHADOW file.",
    );

    const deleted = await this.deps.userRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("User not found");
  }
}

/** Deletes the current user (self-deletion). Auth only; no permission check. */
export class DeleteCurrentUserUseCase {
  constructor(private readonly deps: { userRepository: UserRepository }) {}

  async execute(input: { userId: string }) {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

    assertNotDcismUser(user, "DCISM users cannot delete their account.");

    await this.deps.userRepository.delete(input.userId);
  }
}
