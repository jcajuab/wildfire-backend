import { z } from "zod";

export const aiProviderSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "azure",
  "mistral",
]);

export const aiMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

export const aiChatRequestSchema = z.object({
  conversationId: z.string().uuid(),
  messages: z.array(aiMessageSchema).min(1),
  provider: aiProviderSchema,
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(8192).optional(),
  toolNames: z.array(z.string()).optional(),
});

export const aiConfirmRequestSchema = z.object({
  conversationId: z.string().uuid(),
  approved: z.boolean(),
});

export const aiCancelPendingSchema = z.object({
  token: z.string().uuid(),
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
