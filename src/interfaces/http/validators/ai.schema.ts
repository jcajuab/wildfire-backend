import { z } from "zod";

export const aiProviderSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "azure",
  "mistral",
]);

// Accept the AI SDK's UIMessage format (id, role, parts[]) sent by
// DefaultChatTransport. We use passthrough() so tool/approval parts
// flow through without exhaustive validation.
export const aiMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant", "system"]),
    parts: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();

export const aiChatRequestSchema = z.object({
  id: z.string().optional(),
  messages: z.array(aiMessageSchema).min(1),
  provider: aiProviderSchema.optional(),
  model: z.string().min(1).optional(),
  conversationId: z.string().uuid().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(8192).optional(),
  trigger: z.string().optional(),
  messageId: z.string().optional(),
});

// Credentials management schemas
export const aiStoreCredentialRequestSchema = z.object({
  provider: aiProviderSchema,
  apiKey: z.string().min(1).max(512),
});

export const aiCredentialProviderParamSchema = z.object({
  provider: aiProviderSchema,
});

export const aiCredentialResponseSchema = z.object({
  id: z.string().uuid(),
  provider: aiProviderSchema,
  keyHint: z.string(), // "...sk-1234"
  createdAt: z.string(),
  updatedAt: z.string(),
});
