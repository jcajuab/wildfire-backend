import { ValidationError } from "#/application/errors/validation";
import { type AICredentialsRepository } from "#/application/ports/ai";
import { type AIKeyEncryptionService } from "#/infrastructure/crypto/ai-key-encryption.service";

export class ResolveApiKeyService {
  constructor(
    private readonly deps: {
      credentialsRepository: AICredentialsRepository;
      encryptionService: AIKeyEncryptionService;
    },
  ) {}

  /**
   * Resolves API key from either header or stored credentials.
   * Priority: Header > Stored
   * Returns decrypted key or throws ValidationError if none available.
   */
  async resolve(input: {
    userId: string;
    provider: string;
    headerApiKey: string | null;
  }): Promise<string> {
    // Header takes priority (allows temporary override of stored key)
    if (input.headerApiKey) {
      return input.headerApiKey;
    }

    // Try stored credentials
    const stored = await this.deps.credentialsRepository.findByUserAndProvider(
      input.userId,
      input.provider,
    );

    if (!stored) {
      throw new ValidationError(
        `No API key available for provider "${input.provider}". ` +
          `Provide via X-AI-Provider-Key header or store credentials via POST /ai/credentials.`,
      );
    }

    // Decrypt and return in-memory only
    return this.deps.encryptionService.decrypt({
      encryptedKey: stored.encryptedKey,
      iv: stored.iv,
      authTag: stored.authTag,
    });
  }
}
