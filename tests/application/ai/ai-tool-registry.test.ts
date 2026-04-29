import { describe, expect, test } from "bun:test";
import { AI_TOOLS } from "#/application/use-cases/ai/ai-tool-registry";
import { AI_SYSTEM_PROMPT } from "#/application/use-cases/ai/system-prompt";

describe("AI tool registry", () => {
  test("registers flash content listing as a read-only tool", () => {
    expect(AI_TOOLS.list_flash_content).toBeDefined();
    expect(AI_TOOLS.list_flash_content.requiresConfirmation).toBe(false);
  });

  test("documents the content listing split in the system prompt", () => {
    expect(AI_SYSTEM_PROMPT).toContain("list_flash_content");
    expect(AI_SYSTEM_PROMPT).toContain("list_content excludes FLASH content");
    expect(AI_SYSTEM_PROMPT).toContain("NEVER include FLASH content");
  });
});
