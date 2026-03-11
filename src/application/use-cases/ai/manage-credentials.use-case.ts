import { NotFoundError } from "#/application/errors/not-found";
import {
  type AICredential,
  type AICredentialsRepository,
  type AuditLogger,
} from "#/application/ports/ai";
import { AIKeyEncryptionService } from "#/infrastructure/crypto/ai-key-encryption.service";

export class StoreAICredentialUseCase {
  constructor(
    private readonly deps: {
      credentialsRepository: AICredentialsRepository;
      encryptionService: AIKeyEncryptionService;
      auditLogger: AuditLogger;
    },
  ) {}

  async execute(input: {
    userId: string;
    provider: string;
    apiKey: string;
  }): Promise<AICredential> {
    const { encryptedKey, iv, authTag } = this.deps.encryptionService.encrypt(
      input.apiKey,
    );
    const keyHint = AIKeyEncryptionService.generateKeyHint(input.apiKey);

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
      throw new NotFoundError(
        `No stored credentials for provider: ${input.provider}`,
      );
    }

    this.deps.auditLogger.log({
      event: "ai.credentials.deleted",
      userId: input.userId,
      metadata: { provider: input.provider },
    });
  }
}

export class ListAICredentialsUseCase {
  constructor(
    private readonly deps: {
      credentialsRepository: AICredentialsRepository;
    },
  ) {}

  async execute(input: { userId: string }): Promise<AICredential[]> {
    return this.deps.credentialsRepository.listForUser(input.userId);
  }
}
