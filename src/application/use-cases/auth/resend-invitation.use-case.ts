import { NotFoundError } from "#/application/errors/not-found";
import { type InvitationRepository } from "#/application/ports/auth";
import { type CreateInvitationUseCase } from "#/application/use-cases/auth/create-invitation.use-case";

export class ResendInvitationUseCase {
  constructor(
    private readonly deps: {
      invitationRepository: InvitationRepository;
      createInvitationUseCase: CreateInvitationUseCase;
    },
  ) {}

  async execute(input: { id: string; invitedByUserId: string }): Promise<{
    id: string;
    expiresAt: string;
    inviteUrl: string;
  }> {
    const existing = await this.deps.invitationRepository.findById({
      id: input.id,
    });
    if (!existing) {
      throw new NotFoundError("Invitation not found.");
    }

    return this.deps.createInvitationUseCase.execute({
      email: existing.email,
      name: existing.name,
      invitedByUserId: input.invitedByUserId,
    });
  }
}
