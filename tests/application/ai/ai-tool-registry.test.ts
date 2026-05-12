import { describe, expect, test } from "bun:test";
import { AI_TOOLS } from "#/application/use-cases/ai/ai-tool-registry";
import { AI_SYSTEM_PROMPT } from "#/application/use-cases/ai/system-prompt";

describe("AI tool registry", () => {
  test("registers flash content listing as a read-only tool", () => {
    expect(AI_TOOLS.list_flash_content).toBeDefined();
    expect(AI_TOOLS.list_flash_content.requiresConfirmation).toBe(false);
  });

  test("registers flash content editing as a confirmed tool", () => {
    expect(AI_TOOLS.edit_flash_content).toBeDefined();
    expect(AI_TOOLS.edit_flash_content.requiresConfirmation).toBe(true);
  });

  test("validates current content and playlist limits", () => {
    expect(
      AI_TOOLS.create_text_content.inputSchema.safeParse({
        title: "Notice",
        text: "x".repeat(361),
      }).success,
    ).toBe(false);
    expect(
      AI_TOOLS.create_flash_content.inputSchema.safeParse({
        title: "Alert",
        text: "Legacy field",
      }).success,
    ).toBe(false);
    expect(
      AI_TOOLS.create_flash_content.inputSchema.safeParse({
        title: "Alert",
        message: "x".repeat(121),
      }).success,
    ).toBe(false);
    expect(
      AI_TOOLS.create_playlist.inputSchema.safeParse({
        name: "Loop",
        items: [{ contentId: crypto.randomUUID(), duration: 61 }],
      }).success,
    ).toBe(false);
  });

  test("requires multi-display schedule targets", () => {
    const base = {
      playlistId: crypto.randomUUID(),
      name: "Morning Loop",
      startDate: "2027-01-01",
      endDate: "2027-01-01",
      startTime: "08:00",
      endTime: "08:30",
    };

    expect(
      AI_TOOLS.create_schedule.inputSchema.safeParse({
        ...base,
        displayId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      AI_TOOLS.create_schedule.inputSchema.safeParse({
        ...base,
        displayIds: [crypto.randomUUID()],
      }).success,
    ).toBe(true);
  });

  test("documents the content listing split in the system prompt", () => {
    expect(AI_SYSTEM_PROMPT).toContain("list_flash_content");
    expect(AI_SYSTEM_PROMPT).toContain("list_content excludes FLASH content");
    expect(AI_SYSTEM_PROMPT).toContain("NEVER include FLASH content");
    expect(AI_SYSTEM_PROMPT).toContain("360 characters");
    expect(AI_SYSTEM_PROMPT).toContain("Playlist total duration");
    expect(AI_SYSTEM_PROMPT).toContain("displayIds");
    expect(AI_SYSTEM_PROMPT).toContain("edit_flash_content");
  });
});
