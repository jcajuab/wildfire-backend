import { NotFoundError } from "#/application/errors/not-found";
import { type InvitationRepository } from "#/application/ports/auth";
import { type AIKeyEncryptionService } from "#/infrastructure/crypto/ai-key-encryption.service";
import { buildInviteUrl } from "./create-invitation.use-case";

export class RevealInvitationLinkUseCase {
  constructor(
    private readonly deps: {
      invitationRepository: InvitationRepository;
      encryptionService: AIKeyEncryptionService;
      inviteAcceptBaseUrl: string;
    },
  ) {}

  async execute(input: { id: string }): Promise<{ inviteUrl: string }> {
    const row = await this.deps.invitationRepository.findEncryptedTokenById(
      input.id,
      new Date(),
    );
    if (!row) {
      throw new NotFoundError("Invitation not found or no longer active.");
    }

    const token = this.deps.encryptionService.decrypt({
      encryptedKey: row.encryptedToken,
      iv: row.tokenIv,
      authTag: row.tokenAuthTag,
    });

    return { inviteUrl: buildInviteUrl(this.deps.inviteAcceptBaseUrl, token) };
  }
}
