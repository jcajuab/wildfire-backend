import { createHash, randomUUID } from "node:crypto";
import { ValidationError } from "#/application/errors/validation";
import { type InvitationRepository } from "#/application/ports/auth";
import { type UserRepository } from "#/application/ports/rbac";
import { type AIKeyEncryptionService } from "#/infrastructure/crypto/ai-key-encryption.service";

const DEFAULT_INVITE_NAME = "User";

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const buildInviteUrl = (baseUrl: string, token: string): string => {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}?token=${encodeURIComponent(token)}`;
};

export class CreateInvitationUseCase {
  constructor(
    private readonly deps: {
      userRepository: UserRepository;
      invitationRepository: InvitationRepository;
      inviteTokenTtlSeconds: number;
      inviteAcceptBaseUrl: string;
      encryptionService: AIKeyEncryptionService;
    },
  ) {}

  async execute(input: {
    email: string;
    name?: string | null;
    invitedByUserId: string;
  }): Promise<{ id: string; expiresAt: string }> {
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
    const name = input.name?.trim() || null;

    const { encryptedKey, iv, authTag } =
      this.deps.encryptionService.encrypt(token);

    await this.deps.invitationRepository.create({
      id,
      hashedToken: hashToken(token),
      email,
      name,
      invitedByUserId: input.invitedByUserId,
      expiresAt,
      encryptedToken: encryptedKey,
      tokenIv: iv,
      tokenAuthTag: authTag,
    });

    return {
      id,
      expiresAt: expiresAt.toISOString(),
    };
  }
}

export { DEFAULT_INVITE_NAME, hashToken };
