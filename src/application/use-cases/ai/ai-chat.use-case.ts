import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/errors/not-found";
import {
  type AICredentialsRepository,
  type AIMessage,
  type AIStreamChunk,
  type AuditLogger,
  type PendingActionStore,
} from "#/application/ports/ai";
import { type AIKeyEncryptionService } from "#/infrastructure/crypto/ai-key-encryption.service";
import { type AIToolExecutor } from "./ai-tool-executor";

export interface AIChatDeps {
  credentialsRepository: AICredentialsRepository;
  encryptionService: AIKeyEncryptionService;
  toolExecutor: AIToolExecutor;
  pendingActionStore: PendingActionStore;
  auditLogger: AuditLogger;
  executeAIChat: (
    config: {
      provider: string;
      model: string;
      apiKey: string;
      temperature?: number;
      maxTokens?: number;
    },
    messages: AIMessage[],
    onToolCall: (
      toolName: string,
      toolCallId: string,
      args: Record<string, unknown>,
    ) => Promise<unknown>,
  ) => Promise<AsyncIterable<AIStreamChunk>>;
}

export class AIChatUseCase {
  constructor(private readonly deps: AIChatDeps) {}

  async execute(input: {
    conversationId: string;
    messages: AIMessage[];
    provider: string;
    model: string;
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
    userId: string;
  }): Promise<AsyncIterable<AIStreamChunk>> {
    // Detect prompt injection attempts
    const injectionPattern = /ignore (previous|all) instructions/i;
    const lastUserMessage = [...input.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (lastUserMessage && injectionPattern.test(lastUserMessage.content)) {
      this.deps.auditLogger.log({
        event: "ai.injection.detected",
        userId: input.userId,
        metadata: {
          conversationId: input.conversationId,
          provider: input.provider,
        },
      });
      throw new ForbiddenError("Request rejected");
    }

    // Resolve API key - prefer per-request key, fall back to stored credential
    let apiKey = input.apiKey;
    if (!apiKey) {
      const stored =
        await this.deps.credentialsRepository.findByUserAndProvider(
          input.userId,
          input.provider,
        );
      if (!stored) {
        throw new NotFoundError(
          `No ${input.provider} API key found. Please provide an API key or store credentials.`,
        );
      }
      apiKey = this.deps.encryptionService.decrypt({
        encryptedKey: stored.encryptedKey,
        iv: stored.iv,
        authTag: stored.authTag,
      });
    }

    this.deps.auditLogger.log({
      event: "ai.chat.started",
      userId: input.userId,
      metadata: {
        conversationId: input.conversationId,
        provider: input.provider,
        model: input.model,
        messageCount: input.messages.length,
      },
    });

    const config = {
      provider: input.provider as
        | "openai"
        | "anthropic"
        | "google"
        | "azure"
        | "mistral",
      model: input.model,
      apiKey,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    };

    const onToolCall = async (
      toolName: string,
      toolCallId: string,
      args: Record<string, unknown>,
    ): Promise<unknown> => {
      const result = await this.deps.toolExecutor.execute(
        { id: toolCallId, toolName, args },
        { userId: input.userId, conversationId: input.conversationId },
      );
      return result;
    };

    const stream = await this.deps.executeAIChat(
      config,
      input.messages,
      onToolCall,
    );

    this.deps.auditLogger.log({
      event: "ai.chat.completed",
      userId: input.userId,
      metadata: {
        conversationId: input.conversationId,
        provider: input.provider,
      },
    });

    return stream;
  }
}
