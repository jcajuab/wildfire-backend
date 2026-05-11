import { NotFoundError } from "#/application/errors/not-found";
import { type InvitationRepository } from "#/application/ports/auth";

export class DeleteInvitationUseCase {
  constructor(
    private readonly deps: {
      invitationRepository: InvitationRepository;
    },
  ) {}

  async execute(input: { id: string }): Promise<void> {
    const deleted = await this.deps.invitationRepository.deleteById(input.id);
    if (!deleted) {
      throw new NotFoundError("Invitation not found.");
    }
  }
}
