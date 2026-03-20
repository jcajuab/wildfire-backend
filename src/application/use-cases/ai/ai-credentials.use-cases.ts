import { NotFoundError } from "#/application/errors/not-found";
import { ValidationError } from "#/application/errors/validation";
import {
  type AICredential,
  type AICredentialsRepository,
  type AuditLogger,
} from "#/application/ports/ai";
import { type EncryptionService } from "#/application/ports/encryption";

export class StoreAICredentialUseCase {
  constructor(
    private readonly deps: {
      credentialsRepository: AICredentialsRepository;
      encryptionService: EncryptionService;
      auditLogger: AuditLogger;
    },
  ) {}

  async execute(input: {
    userId: string;
    provider: string;
    apiKey: string;
  }): Promise<AICredential> {
    if (!input.apiKey || input.apiKey.trim().length === 0) {
      throw new ValidationError("API key is required");
    }

    const { encryptedKey, iv, authTag } = this.deps.encryptionService.encrypt(
      input.apiKey,
    );
    const keyHint = this.deps.encryptionService.generateKeyHint(input.apiKey);

    const credential = await this.deps.credentialsRepository.create({
      userId: input.userId,
      provider: input.provider,
      encryptedKey,
      keyHint,
      iv,
      authTag,
    });

    this.deps.auditLogger.log({
      event: "ai.credentials.stored",
      userId: input.userId,
      metadata: { provider: input.provider },
    });

    return credential;
  }
}

export class ListAICredentialsUseCase {
  constructor(
    private readonly deps: {
      credentialsRepository: AICredentialsRepository;
    },
  ) {}

  async execute(userId: string): Promise<AICredential[]> {
    return this.deps.credentialsRepository.listForUser(userId);
  }
}

export class DeleteAICredentialUseCase {
  constructor(
    private readonly deps: {
      credentialsRepository: AICredentialsRepository;
      auditLogger: AuditLogger;
    },
  ) {}

  async execute(input: { userId: string; provider: string }): Promise<void> {
    const deleted = await this.deps.credentialsRepository.delete(
      input.userId,
      input.provider,
    );

    if (!deleted) {
      throw new NotFoundError(`No ${input.provider} credential found`);
    }

    this.deps.auditLogger.log({
      event: "ai.credentials.deleted",
      userId: input.userId,
      metadata: { provider: input.provider },
    });
  }
}
