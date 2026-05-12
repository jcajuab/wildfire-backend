import { describe, expect, test } from "bun:test";
import {
  getAIStreamErrorMessage,
  sanitizeAIStreamResponse,
} from "#/interfaces/http/routes/ai/ai-stream-response";

const readResponseText = async (response: Response) =>
  await new Response(response.body).text();

describe("AI stream response helpers", () => {
  test("strips provider metadata from streamed tool output chunks", async () => {
    const chunk = {
      type: "tool-output-available",
      toolCallId: "call-1",
      output: {
        success: true,
        message: "Created content.",
        data: { id: "content-1" },
      },
      providerMetadata: {
        google: { thoughtSignature: "opaque-provider-value" },
      },
    };

    const response = sanitizeAIStreamResponse(
      new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const text = await readResponseText(response);
    expect(text).toContain("tool-output-available");
    expect(text).toContain("Created content.");
    expect(text).not.toContain("providerMetadata");
    expect(text).not.toContain("thoughtSignature");
  });

  test("maps raw stream validation errors to a generic message", () => {
    expect(
      getAIStreamErrorMessage(
        new Error(
          'Type validation failed: Value: {"type":"tool-output-available"}',
        ),
      ),
    ).toBe("The AI response could not be displayed. Please try again.");
  });

  test("maps provider rate limits to a short retry message", () => {
    expect(getAIStreamErrorMessage(new Error("Rate limit exceeded"))).toBe(
      "AI request limit reached. Please wait and try again.",
    );
  });
});
