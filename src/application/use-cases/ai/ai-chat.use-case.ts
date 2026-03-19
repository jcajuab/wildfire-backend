import { type UIMessage } from "ai";
import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/errors/not-found";
import {
  type AICredentialsRepository,
  type AIStreamResponse,
  type AuditLogger,
} from "#/application/ports/ai";
import { type AIKeyEncryptionService } from "#/infrastructure/crypto/ai-key-encryption.service";
import { type AIToolExecutor } from "./ai-tool-executor";
import {
  AI_SYSTEM_PROMPT,
  detectPromptInjection,
  sanitizeUserMessage,
} from "./system-prompt";

/** Extract the concatenated text from a UIMessage's parts. */
function extractText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export interface AIChatDeps {
  credentialsRepository: AICredentialsRepository;
  encryptionService: AIKeyEncryptionService;
  toolExecutor: AIToolExecutor;
  auditLogger: AuditLogger;
  executeAIChat: (
    config: {
      provider: "openai" | "anthropic" | "google" | "azure" | "mistral";
      model: string;
      apiKey: string;
      temperature?: number;
      maxTokens?: number;
    },
    messages: UIMessage[],
    onToolCall: (
      toolName: string,
      toolCallId: string,
      args: Record<string, unknown>,
    ) => Promise<unknown>,
    systemPrompt?: string,
  ) => Promise<AIStreamResponse>;
}

export class AIChatUseCase {
  constructor(private readonly deps: AIChatDeps) {}

  async execute(input: {
    conversationId: string;
    messages: UIMessage[];
    provider: string;
    model: string;
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
    userId: string;
  }): Promise<AIStreamResponse> {
    // Detect prompt injection attempts
    const lastUserMessage = [...input.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (
      lastUserMessage &&
      detectPromptInjection(extractText(lastUserMessage))
    ) {
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

    // Sanitize user text parts to prevent injection via control characters.
    // UIMessage parts are immutable-shaped, so we rebuild the parts array.
    const sanitizedMessages: UIMessage[] = input.messages.map((m) => {
      if (m.role !== "user") return m;
      return {
        ...m,
        parts: m.parts.map((p) =>
          p.type === "text" ? { ...p, text: sanitizeUserMessage(p.text) } : p,
        ),
      };
    });

    const result = await this.deps.executeAIChat(
      config,
      sanitizedMessages,
      onToolCall,
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
