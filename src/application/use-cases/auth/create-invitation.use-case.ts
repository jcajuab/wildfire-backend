import { createHash, randomUUID } from "node:crypto";
import { ValidationError } from "#/application/errors/validation";
import { type InvitationRepository } from "#/application/ports/auth";
import { type InvitationEmailSender } from "#/application/ports/notifications";
import { type UserRepository } from "#/application/ports/rbac";

const DEFAULT_INVITE_NAME = "User";

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const buildInviteUrl = (baseUrl: string, token: string): string => {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}?token=${encodeURIComponent(token)}`;
};

export class CreateInvitationUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      invitationRepository: InvitationRepository;
      invitationEmailSender: InvitationEmailSender;
      inviteTokenTtlSeconds: number;
      inviteAcceptBaseUrl: string;
    },
  ) {}

  async execute(input: {
    email: string;
    name?: string | null;
    invitedByUserId: string;
  }): Promise<{ id: string; expiresAt: string; inviteUrl: string }> {
    const email = input.email.trim().toLowerCase();
    if (email.length === 0) {
      throw new ValidationError("Email is required.");
    }

    const existingUser = await this.deps.userRepository.findByEmail(email);
    if (existingUser) {
      throw new ValidationError("A user with this email already exists.");
    }

    const now = new Date();
    await this.deps.invitationRepository.deleteExpired(now);
    await this.deps.invitationRepository.revokeActiveByEmail(email, now);

    const token = randomUUID();
    const id = randomUUID();
    const expiresAt = new Date(
      now.getTime() + this.deps.inviteTokenTtlSeconds * 1000,
    );
    const inviteUrl = buildInviteUrl(this.deps.inviteAcceptBaseUrl, token);
    const name = input.name?.trim() || null;

    await this.deps.invitationRepository.create({
      id,
      hashedToken: hashToken(token),
      email,
      name,
      invitedByUserId: input.invitedByUserId,
      expiresAt,
    });

    await this.deps.invitationEmailSender.sendInvite({
      email,
      inviteUrl,
      expiresAt,
    });

    return {
      id,
      expiresAt: expiresAt.toISOString(),
      inviteUrl,
    };
  }
}

export { DEFAULT_INVITE_NAME, hashToken };
