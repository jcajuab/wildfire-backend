import { describe, expect, test } from "bun:test";
import { type AIToolCall, type AIToolResult } from "#/application/ports/ai";
import { type AuditLogger } from "#/application/ports/audit";
import { AIToolExecutor } from "#/application/use-cases/ai/ai-tool-executor";

const noopLogger: AuditLogger = { log: () => {} };

const makeSpyUseCase = <TInput, TOutput>(
  returnValue: TOutput,
): {
  execute: (input: TInput) => Promise<TOutput>;
  lastInput: TInput | null;
} => {
  const spy = {
    lastInput: null as TInput | null,
    execute: async (input: TInput): Promise<TOutput> => {
      spy.lastInput = input;
      return returnValue;
    },
  };
  return spy;
};

const baseContentView = {
  id: "content-1",
  title: "Test",
  type: "TEXT" as const,
  status: "READY" as const,
  fileKey: "key",
  checksum: "abc",
  mimeType: "text/plain",
  fileSize: 10,
  width: null,
  height: null,
  duration: null,
  ownerId: "user-1",
  ownerName: null,
  flashMessage: null,
  flashTone: null,
  textJsonContent: null,
  textHtmlContent: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

const basePlaylistView = {
  id: "playlist-1",
  name: "Test Playlist",
  description: null,
  status: "DRAFT" as const,
  ownerId: "user-1",
  ownerName: null,
  itemsCount: 0,
  totalDuration: 0,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

const baseScheduleView = {
  id: "schedule-1",
  name: "Test Schedule",
  kind: "PLAYLIST" as const,
  playlistId: "playlist-1",
  contentId: null,
  displayId: "display-1",
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  startTime: "08:00",
  endTime: "18:00",
  ownerId: "user-1",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

const makeDeps = () => {
  const updateContent = makeSpyUseCase<
    Parameters<
      InstanceType<
        typeof import("#/application/use-cases/content/update-content.use-case").UpdateContentUseCase
      >["execute"]
    >[0],
    typeof baseContentView
  >(baseContentView);

  const deleteContent = {
    lastInput: null as { id: string; ownerId: string } | null,
    execute: async (input: { id: string; ownerId: string }) => {
      deleteContent.lastInput = input;
    },
  };

  const updatePlaylist = makeSpyUseCase<
    Record<string, unknown>,
    typeof basePlaylistView
  >(basePlaylistView);

  const deletePlaylist = {
    lastInput: null as { id: string; ownerId: string } | null,
    execute: async (input: { id: string; ownerId: string }) => {
      deletePlaylist.lastInput = input;
    },
  };

  const updateSchedule = makeSpyUseCase<
    Record<string, unknown>,
    typeof baseScheduleView
  >(baseScheduleView);

  const deleteSchedule = {
    lastInput: null as { id: string; ownerId: string } | null,
    execute: async (input: { id: string; ownerId: string }) => {
      deleteSchedule.lastInput = input;
    },
  };

  const noopUseCase = { execute: async () => ({ id: "x" }) };

  const executor = new AIToolExecutor({
    createFlashContentUseCase: noopUseCase as never,
    createTextContentUseCase: noopUseCase as never,
    updateContentUseCase: updateContent as never,
    deleteContentUseCase: deleteContent as never,
    createPlaylistUseCase: noopUseCase as never,
    updatePlaylistUseCase: updatePlaylist as never,
    deletePlaylistUseCase: deletePlaylist as never,
    replacePlaylistItemsAtomicUseCase: noopUseCase as never,
    createScheduleUseCase: noopUseCase as never,
    updateScheduleUseCase: updateSchedule as never,
    deleteScheduleUseCase: deleteSchedule as never,
    listDisplaysUseCase: {
      execute: async () => ({ items: [], total: 0 }),
    } as never,
    listContentUseCase: {
      execute: async () => ({ items: [], total: 0 }),
    } as never,
    listPlaylistsUseCase: {
      execute: async () => ({ items: [], total: 0 }),
    } as never,
    listSchedulesUseCase: {
      execute: async () => ({ items: [], total: 0 }),
    } as never,
    auditLogger: noopLogger,
  });

  return {
    executor,
    updateContent,
    deleteContent,
    updatePlaylist,
    deletePlaylist,
    updateSchedule,
    deleteSchedule,
  };
};

// Valid UUIDs required by the tool input schemas (fourth group must start with [89ab])
const CONTENT_ID = "550e8400-e29b-41d4-a716-446655440001";
const PLAYLIST_ID = "550e8400-e29b-41d4-a716-446655440002";
const SCHEDULE_ID = "550e8400-e29b-41d4-a716-446655440003";
const SCHEDULE_ID_2 = "550e8400-e29b-41d4-a716-446655440004";

const ctx = { userId: "user-42", conversationId: "conv-1" };

describe("AIToolExecutor – edit/delete ownership routing", () => {
  describe("edit_content", () => {
    test("passes ownerId from context to updateContentUseCase", async () => {
      const { executor, updateContent } = makeDeps();
      const toolCall: AIToolCall = {
        id: "tc-1",
        toolName: "edit_content",
        args: {
          contentId: CONTENT_ID,
          title: "New Title",
          text: "Hello world",
        },
      };
      const result = await executor.execute(toolCall, ctx);
      expect(result.success).toBe(true);
      expect(updateContent.lastInput?.id).toBe(CONTENT_ID);
      expect(updateContent.lastInput?.ownerId).toBe("user-42");
      expect(updateContent.lastInput?.title).toBe("New Title");
    });

    test("title-only edit passes ownerId without text conversion", async () => {
      const { executor, updateContent } = makeDeps();
      const toolCall: AIToolCall = {
        id: "tc-2",
        toolName: "edit_content",
        args: { contentId: CONTENT_ID, title: "Renamed" },
      };
      await executor.execute(toolCall, ctx);
      expect(updateContent.lastInput?.ownerId).toBe("user-42");
      expect(updateContent.lastInput?.textJsonContent).toBeUndefined();
    });
  });

  describe("delete_content", () => {
    test("passes ownerId from context to deleteContentUseCase", async () => {
      const { executor, deleteContent } = makeDeps();
      const toolCall: AIToolCall = {
        id: "tc-3",
        toolName: "delete_content",
        args: { contentId: CONTENT_ID },
      };
      const result = await executor.execute(toolCall, ctx);
      expect(result.success).toBe(true);
      expect(deleteContent.lastInput?.id).toBe(CONTENT_ID);
      expect(deleteContent.lastInput?.ownerId).toBe("user-42");
    });
  });

  describe("edit_playlist", () => {
    test("passes ownerId from context to updatePlaylistUseCase", async () => {
      const { executor, updatePlaylist } = makeDeps();
      const toolCall: AIToolCall = {
        id: "tc-4",
        toolName: "edit_playlist",
        args: { playlistId: PLAYLIST_ID, name: "Renamed Playlist" },
      };
      const result = await executor.execute(toolCall, ctx);
      expect(result.success).toBe(true);
      const input = updatePlaylist.lastInput as Record<string, unknown>;
      expect(input.id).toBe(PLAYLIST_ID);
      expect(input.ownerId).toBe("user-42");
    });
  });

  describe("delete_playlist", () => {
    test("passes ownerId from context to deletePlaylistUseCase", async () => {
      const { executor, deletePlaylist } = makeDeps();
      const toolCall: AIToolCall = {
        id: "tc-5",
        toolName: "delete_playlist",
        args: { playlistId: PLAYLIST_ID },
      };
      const result = await executor.execute(toolCall, ctx);
      expect(result.success).toBe(true);
      expect(deletePlaylist.lastInput?.id).toBe(PLAYLIST_ID);
      expect(deletePlaylist.lastInput?.ownerId).toBe("user-42");
    });
  });

  describe("edit_schedule", () => {
    test("passes ownerId from context to updateScheduleUseCase", async () => {
      const { executor, updateSchedule } = makeDeps();
      const toolCall: AIToolCall = {
        id: "tc-6",
        toolName: "edit_schedule",
        args: { scheduleId: SCHEDULE_ID, name: "Renamed Schedule" },
      };
      const result = await executor.execute(toolCall, ctx);
      expect(result.success).toBe(true);
      const input = updateSchedule.lastInput as Record<string, unknown>;
      expect(input.id).toBe(SCHEDULE_ID);
      expect(input.ownerId).toBe("user-42");
    });
  });

  describe("delete_schedule", () => {
    test("passes ownerId from context to deleteScheduleUseCase", async () => {
      const { executor, deleteSchedule } = makeDeps();
      const toolCall: AIToolCall = {
        id: "tc-7",
        toolName: "delete_schedule",
        args: { scheduleId: SCHEDULE_ID },
      };
      const result = await executor.execute(toolCall, ctx);
      expect(result.success).toBe(true);
      expect(deleteSchedule.lastInput?.id).toBe(SCHEDULE_ID);
      expect(deleteSchedule.lastInput?.ownerId).toBe("user-42");
    });
  });

  describe("edit_flash_schedule", () => {
    test("passes ownerId from context to updateScheduleUseCase", async () => {
      const { executor, updateSchedule } = makeDeps();
      const toolCall: AIToolCall = {
        id: "tc-8",
        toolName: "edit_flash_schedule",
        args: { scheduleId: SCHEDULE_ID_2, name: "Flash Renamed" },
      };
      const result = await executor.execute(toolCall, ctx);
      expect(result.success).toBe(true);
      const input = updateSchedule.lastInput as Record<string, unknown>;
      expect(input.id).toBe(SCHEDULE_ID_2);
      expect(input.ownerId).toBe("user-42");
    });
  });

  describe("delete_flash_schedule", () => {
    test("passes ownerId from context to deleteScheduleUseCase", async () => {
      const { executor, deleteSchedule } = makeDeps();
      const toolCall: AIToolCall = {
        id: "tc-9",
        toolName: "delete_flash_schedule",
        args: { scheduleId: SCHEDULE_ID_2 },
      };
      const result = await executor.execute(toolCall, ctx);
      expect(result.success).toBe(true);
      expect(deleteSchedule.lastInput?.id).toBe(SCHEDULE_ID_2);
      expect(deleteSchedule.lastInput?.ownerId).toBe("user-42");
    });
  });

  test("returns error for unknown tool", async () => {
    const { executor } = makeDeps();
    const result: AIToolResult = await executor.execute(
      { id: "tc-x", toolName: "nonexistent_tool", args: {} },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });

  test("returns error for invalid args", async () => {
    const { executor } = makeDeps();
    const result = await executor.execute(
      { id: "tc-y", toolName: "delete_content", args: {} },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid parameters");
  });
});
