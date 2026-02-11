import { type ContentStorage } from "#/application/ports/content";
import { type UserRepository } from "#/application/ports/rbac";
import { NotFoundError } from "#/application/use-cases/rbac/errors";

const AVATAR_KEY_PREFIX = "avatars/";

export interface SetCurrentUserAvatarInput {
  userId: string;
  body: Uint8Array;
  contentType: string;
  contentLength: number;
}

export class SetCurrentUserAvatarUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      storage: ContentStorage;
    },
  ) {}

  async execute(
    input: SetCurrentUserAvatarInput,
  ): Promise<{ avatarKey: string }> {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) throw new NotFoundError("User not found");

    const key = `${AVATAR_KEY_PREFIX}${input.userId}`;

    if (user.avatarKey) {
      await this.deps.storage.delete(user.avatarKey);
    }

    await this.deps.storage.upload({
      key,
      body: input.body,
      contentType: input.contentType,
      contentLength: input.contentLength,
    });

    await this.deps.userRepository.update(input.userId, { avatarKey: key });
    return { avatarKey: key };
  }
}
