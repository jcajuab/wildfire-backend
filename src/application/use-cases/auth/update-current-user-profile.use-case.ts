import { type UserRepository } from "#/application/ports/rbac";
import { NotFoundError } from "#/application/use-cases/rbac/errors";

export interface UpdateCurrentUserProfileInput {
  userId: string;
  name?: string;
  timezone?: string | null;
}

export class UpdateCurrentUserProfileUseCase {
  constructor(private readonly deps: { userRepository: UserRepository }) {}

  async execute(input: UpdateCurrentUserProfileInput) {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

    const updated = await this.deps.userRepository.update(input.userId, {
      name: input.name,
      timezone: input.timezone,
    });
    if (!updated) throw new NotFoundError("User not found");
    return updated;
  }
}
