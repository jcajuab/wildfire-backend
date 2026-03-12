import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/errors/not-found";
import {
  type AICredentialsRepository,
  type AIMessage,
  type AIStreamResponse,
  type AuditLogger,
  type PendingActionStore,
} from "#/application/ports/ai";
import { type AIKeyEncryptionService } from "#/infrastructure/crypto/ai-key-encryption.service";
import { type AIToolExecutor } from "./ai-tool-executor";
import {
  AI_SYSTEM_PROMPT,
  detectPromptInjection,
  sanitizeUserMessage,
} from "./system-prompt";

export interface AIChatDeps {
  credentialsRepository: AICredentialsRepository;
  encryptionService: AIKeyEncryptionService;
  toolExecutor: AIToolExecutor;
  pendingActionStore: PendingActionStore;
  auditLogger: AuditLogger;
  executeAIChat: (
    config: {
      provider: "openai" | "anthropic" | "google" | "azure" | "mistral";
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
    toolNames?: string[],
    systemPrompt?: string,
  ) => AIStreamResponse;
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
    toolNames?: string[];
    userId: string;
  }): Promise<AIStreamResponse> {
    // Detect prompt injection attempts
    const lastUserMessage = [...input.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (lastUserMessage && detectPromptInjection(lastUserMessage.content)) {
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

    const sanitizedMessages = input.messages.map((m) =>
      m.role === "user" ? { ...m, content: sanitizeUserMessage(m.content) } : m,
    );

    const result = this.deps.executeAIChat(
      config,
      sanitizedMessages,
      onToolCall,
      input.toolNames,
      AI_SYSTEM_PROMPT,
    );

    this.deps.auditLogger.log({
      event: "ai.chat.started.streaming",
      userId: input.userId,
      metadata: {
        conversationId: input.conversationId,
        provider: input.provider,
      },
    });

    return result;
  }
}
