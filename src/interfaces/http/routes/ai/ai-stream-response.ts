import {
  APICallError,
  InvalidToolInputError,
  NoSuchToolError,
  TypeValidationError,
  UIMessageStreamError,
} from "ai";

const TOOL_ERROR_MESSAGE =
  "The AI assistant could not complete that action. Please adjust the request and try again.";
const STREAM_ERROR_MESSAGE =
  "The AI response could not be displayed. Please try again.";
const PROVIDER_ERROR_MESSAGE =
  "The selected AI provider could not complete the request.";
const RATE_LIMIT_ERROR_MESSAGE =
  "AI request limit reached. Please wait and try again.";
const DEFAULT_ERROR_MESSAGE =
  "The AI assistant is unavailable right now. Please try again.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getErrorText = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
};

export const getAIStreamErrorMessage = (error: unknown): string => {
  const text = getErrorText(error).toLowerCase();

  if (text.includes("rate limit") || text.includes("too many requests")) {
    return RATE_LIMIT_ERROR_MESSAGE;
  }

  if (
    TypeValidationError.isInstance(error) ||
    UIMessageStreamError.isInstance(error) ||
    text.includes("type validation failed") ||
    text.includes("uimessagestream")
  ) {
    return STREAM_ERROR_MESSAGE;
  }

  if (
    InvalidToolInputError.isInstance(error) ||
    NoSuchToolError.isInstance(error)
  ) {
    return TOOL_ERROR_MESSAGE;
  }

  if (APICallError.isInstance(error)) {
    return PROVIDER_ERROR_MESSAGE;
  }

  if (
    text.includes("tool") ||
    text.includes("invalid input") ||
    text.includes("validation")
  ) {
    return TOOL_ERROR_MESSAGE;
  }

  return DEFAULT_ERROR_MESSAGE;
};

const shouldStripProviderMetadata = (chunk: Record<string, unknown>) => {
  const type = chunk.type;
  return typeof type === "string" && type.startsWith("tool-output-");
};

const sanitizeDataPayload = (payload: string): string => {
  if (payload.length === 0 || payload === "[DONE]") return payload;

  try {
    const parsed = JSON.parse(payload) as unknown;
    if (isRecord(parsed) && shouldStripProviderMetadata(parsed)) {
      const { providerMetadata: _providerMetadata, ...rest } = parsed;
      return JSON.stringify(rest);
    }
  } catch {
    return payload;
  }

  return payload;
};

const sanitizeSSEEvent = (event: string): string =>
  event
    .split("\n")
    .map((line) => {
      if (!line.startsWith("data:")) return line;
      const prefix = line.startsWith("data: ") ? "data: " : "data:";
      const payload = line.slice(prefix.length);
      return `${prefix}${sanitizeDataPayload(payload)}`;
    })
    .join("\n");

export const sanitizeAIStreamResponse = (response: Response): Response => {
  if (!response.body) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          controller.enqueue(encoder.encode(`${sanitizeSSEEvent(event)}\n\n`));
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer.length > 0) {
          controller.enqueue(encoder.encode(sanitizeSSEEvent(buffer)));
        }
      },
    }),
  );

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
