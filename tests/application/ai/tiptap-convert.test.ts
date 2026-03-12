import { describe, expect, test } from "bun:test";
import { convertPlainTextToTipTap } from "#/application/use-cases/ai/tiptap-convert";

describe("convertPlainTextToTipTap", () => {
  test("single line produces one paragraph", () => {
    const result = convertPlainTextToTipTap("Hello world");

    expect(result.jsonContent).toBe(
      JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello world" }],
          },
        ],
      }),
    );
    expect(result.htmlContent).toBe("<p>Hello world</p>");
  });

  test("multi-line produces separate paragraphs", () => {
    const result = convertPlainTextToTipTap("Line one\nLine two");

    const parsed = JSON.parse(result.jsonContent);
    expect(parsed.content).toHaveLength(2);
    expect(parsed.content[0].content[0].text).toBe("Line one");
    expect(parsed.content[1].content[0].text).toBe("Line two");
    expect(result.htmlContent).toBe("<p>Line one</p><p>Line two</p>");
  });

  test("empty lines are filtered out", () => {
    const result = convertPlainTextToTipTap("First\n\n\nSecond");

    const parsed = JSON.parse(result.jsonContent);
    expect(parsed.content).toHaveLength(2);
    expect(result.htmlContent).toBe("<p>First</p><p>Second</p>");
  });

  test("whitespace-only lines are filtered out", () => {
    const result = convertPlainTextToTipTap("First\n   \n\t\nSecond");

    const parsed = JSON.parse(result.jsonContent);
    expect(parsed.content).toHaveLength(2);
  });

  test("HTML special characters are escaped in HTML output", () => {
    const result = convertPlainTextToTipTap('font-size < 12 & "bold" > normal');

    expect(result.htmlContent).toBe(
      "<p>font-size &lt; 12 &amp; &quot;bold&quot; &gt; normal</p>",
    );
  });

  test("HTML special characters are preserved raw in JSON content", () => {
    const result = convertPlainTextToTipTap("<script>alert('xss')</script>");

    const parsed = JSON.parse(result.jsonContent);
    expect(parsed.content[0].content[0].text).toBe(
      "<script>alert('xss')</script>",
    );
  });

  test("JSON content has correct TipTap document structure", () => {
    const result = convertPlainTextToTipTap("Test");

    const parsed = JSON.parse(result.jsonContent);
    expect(parsed.type).toBe("doc");
    expect(parsed.content[0].type).toBe("paragraph");
    expect(parsed.content[0].content[0].type).toBe("text");
  });
});
