import { type InvitationRepository } from "#/application/ports/auth";

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

const resolveStatus = (input: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  now: Date;
}): InvitationStatus => {
  if (input.acceptedAt) return "accepted";
  if (input.revokedAt) return "revoked";
  if (input.expiresAt.getTime() <= input.now.getTime()) return "expired";
  return "pending";
};

export class ListInvitationsUseCase {
  constructor(
    private readonly deps: {
      invitationRepository: InvitationRepository;
    },
  ) {}

  async execute(input?: { page?: number; pageSize?: number }): Promise<{
    items: {
      id: string;
      email: string;
      name: string | null;
      status: InvitationStatus;
      expiresAt: string;
      createdAt: string;
    }[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, Math.trunc(input?.page ?? 1));
    const pageSize = Math.max(
      1,
      Math.min(Math.trunc(input?.pageSize ?? 100), 250),
    );
    const now = new Date();
    const [invitations, total] = await Promise.all([
      this.deps.invitationRepository.listPage({
        page,
        pageSize,
      }),
      this.deps.invitationRepository.countAll(),
    ]);

    return {
      items: invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        name: invitation.name,
        status: resolveStatus({
          acceptedAt: invitation.acceptedAt,
          revokedAt: invitation.revokedAt,
          expiresAt: invitation.expiresAt,
          now,
        }),
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }
}
