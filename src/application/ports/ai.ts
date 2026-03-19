export interface AIProviderConfig {
  provider: "openai" | "anthropic" | "google" | "azure" | "mistral";
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface AIToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Minimal interface for the streamText result used by the chat route. */
export interface AIStreamResponse {
  toUIMessageStreamResponse(options?: {
    headers?: Record<string, string>;
  }): Response;
}

export interface AICredential {
  id: string;
  userId: string;
  provider: AIProviderConfig["provider"];
  keyHint: string; // "...sk-1234"
  createdAt: string;
  updatedAt: string;
}

export interface AICredentialsRepository {
  create(input: {
    userId: string;
    provider: string;
    encryptedKey: string;
    keyHint: string;
    iv: string;
    authTag: string;
  }): Promise<AICredential>;

  findByUserAndProvider(
    userId: string,
    provider: string,
  ): Promise<{ encryptedKey: string; iv: string; authTag: string } | null>;

  listForUser(userId: string): Promise<AICredential[]>;

  delete(userId: string, provider: string): Promise<boolean>;
}

export interface AuditLogger {
  log(input: {
    event: string;
    userId: string;
    metadata?: Record<string, unknown>;
  }): void;
}
