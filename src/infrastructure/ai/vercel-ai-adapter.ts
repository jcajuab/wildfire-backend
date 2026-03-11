import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { type ModelMessage, streamText, tool } from "ai";
import { type AIMessage, type AIStreamChunk } from "#/application/ports/ai";
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

// biome-ignore lint/suspicious/noExplicitAny: tool() returns vary based on schema generics
const buildTools = (): Record<string, any> => {
  const tools: Record<string, unknown> = {};

  for (const [name, toolDef] of Object.entries(AI_TOOLS)) {
    tools[name] = tool({
      description: toolDef.description,
      // biome-ignore lint/suspicious/noExplicitAny: schema type varies per tool
      inputSchema: toolDef.parameters as any,
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
  messages: AIMessage[],
  onToolCall: (
    toolName: string,
    toolCallId: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>,
  toolNames?: string[],
): Promise<AsyncIterable<AIStreamChunk>> => {
  const aiModel = createAIModel(config);
  // biome-ignore lint/suspicious/noExplicitAny: tool() returns vary based on schema generics
  let tools: Record<string, any> = buildTools();

  if (toolNames?.length) {
    // biome-ignore lint/suspicious/noExplicitAny: tool() returns vary based on schema generics
    const filtered: Record<string, any> = {};
    for (const name of toolNames) {
      if (tools[name]) {
        filtered[name] = tools[name];
      }
    }
    tools = filtered;
  }

  let toolChoice: { type: "tool"; toolName: string } | "required" | undefined;
  if (toolNames?.length === 1) {
    toolChoice = { type: "tool", toolName: toolNames[0] as string };
  } else if (toolNames && toolNames.length > 1) {
    toolChoice = "required";
  }

  const modelMessages: ModelMessage[] = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  const { fullStream } = streamText({
    model: aiModel,
    messages: modelMessages,
    tools,
    toolChoice,
    temperature: config.temperature,
    maxOutputTokens: config.maxTokens,
  });

  return (async function* (): AsyncGenerator<AIStreamChunk> {
    for await (const part of fullStream) {
      switch (part.type) {
        case "text-delta": {
          yield {
            type: "text",
            content: part.text,
          };
          break;
        }

        case "tool-call": {
          const toolCallChunk: AIStreamChunk = {
            type: "tool-call",
            toolCall: {
              id: part.toolCallId,
              toolName: part.toolName,
              args: part.input as Record<string, unknown>,
            },
          };
          yield toolCallChunk;

          // Execute the tool and yield result
          try {
            const result = await onToolCall(
              part.toolName,
              part.toolCallId,
              part.input as Record<string, unknown>,
            );

            yield {
              type: "tool-result",
              toolResult: {
                success: true,
                data: result,
              },
            };
          } catch (error) {
            yield {
              type: "tool-result",
              toolResult: {
                success: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "Tool execution failed",
              },
            };
          }
          break;
        }

        case "error": {
          yield {
            type: "error",
            error:
              part.error instanceof Error
                ? part.error.message
                : "AI stream error",
          };
          break;
        }

        case "finish": {
          yield { type: "done" };
          break;
        }

        default:
          // Skip other event types (step-start, step-finish, etc.)
          break;
      }
    }
  })();
};
