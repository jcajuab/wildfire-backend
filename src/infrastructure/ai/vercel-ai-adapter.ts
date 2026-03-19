import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type ToolSet,
  tool,
  type UIMessage,
} from "ai";
import { type AIStreamResponse } from "#/application/ports/ai";
import { AI_TOOLS } from "#/application/use-cases/ai/ai-tool-registry";

export const createAIModel = (config: {
  provider: "openai" | "anthropic" | "google" | "azure" | "mistral";
  model: string;
  apiKey: string;
}) => {
  switch (config.provider) {
    case "openai": {
      const provider = createOpenAI({ apiKey: config.apiKey });
      return provider(config.model);
    }
    case "anthropic": {
      const provider = createAnthropic({ apiKey: config.apiKey });
      return provider(config.model);
    }
    case "google": {
      const provider = createGoogleGenerativeAI({ apiKey: config.apiKey });
      return provider(config.model);
    }
    case "azure":
    case "mistral": {
      // Fall through to openai-compatible
      const provider = createOpenAI({ apiKey: config.apiKey });
      return provider(config.model);
    }
    default:
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
};

const buildTools = (
  onToolCall: (
    toolName: string,
    toolCallId: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>,
): ToolSet => {
  const tools: ToolSet = {};

  for (const [name, toolDef] of Object.entries(AI_TOOLS)) {
    tools[name] = tool({
      description: toolDef.description,
      // biome-ignore lint/suspicious/noExplicitAny: union of specific Zod schemas cannot be narrowed without per-tool overloads
      inputSchema: toolDef.inputSchema as any,
      needsApproval: toolDef.requiresConfirmation,
      execute: async (args, { toolCallId }: { toolCallId: string }) => {
        return onToolCall(name, toolCallId, args as Record<string, unknown>);
      },
    });
  }

  return tools;
};

export const executeAIChat = async (
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
): Promise<AIStreamResponse> => {
  const aiModel = createAIModel(config);
  const tools: ToolSet = buildTools(onToolCall);

  // Convert UIMessage[] (from the SDK's DefaultChatTransport) to
  // ModelMessage[] that streamText expects. This preserves tool call/result
  // parts so the needsApproval round-trip works correctly.
  const modelMessages = await convertToModelMessages(messages);

  // toolChoice is intentionally left as "auto" (the default). Forcing
  // toolChoice to a specific tool or "required" causes the model to repeat
  // the same tool call on every step, resulting in duplicate side-effects.
  return streamText({
    model: aiModel,
    system: systemPrompt,
    messages: modelMessages,
    tools,
    temperature: config.temperature,
    maxOutputTokens: config.maxTokens,
    maxRetries: 0,
    stopWhen: stepCountIs(10),
  });
};
