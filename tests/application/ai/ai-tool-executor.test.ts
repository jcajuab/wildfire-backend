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
  textHtmlContent: "<p>Do not leak raw HTML</p>",
  textPreviewText: "Do not leak raw HTML",
  isUsedInPlaylist: false,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

const flashContentView = {
  ...baseContentView,
  id: "content-2",
  title: "Flash Alert",
  type: "FLASH" as const,
  flashMessage: "Alert",
  flashTone: "WARNING" as const,
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

  const createFlashContent = makeSpyUseCase<
    Record<string, unknown>,
    typeof flashContentView
  >(flashContentView);

  const createPlaylist = makeSpyUseCase<
    Record<string, unknown>,
    typeof basePlaylistView
  >(basePlaylistView);

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

  const createdSchedules: Record<string, unknown>[] = [];
  const createSchedule = {
    lastInput: null as Record<string, unknown> | null,
    execute: async (input: Record<string, unknown>) => {
      createSchedule.lastInput = input;
      createdSchedules.push(input);
      return {
        ...baseScheduleView,
        id: `schedule-${createdSchedules.length}`,
        displayId: String(input.displayId),
      };
    },
  };

  const deleteSchedule = {
    lastInput: null as { id: string; ownerId: string } | null,
    execute: async (input: { id: string; ownerId: string }) => {
      deleteSchedule.lastInput = input;
    },
  };

  const noopUseCase = { execute: async () => ({ id: "x" }) };
  const listContent = makeSpyUseCase<
    Record<string, unknown>,
    {
      items: Array<typeof baseContentView | typeof flashContentView>;
      total: number;
    }
  >({
    items: [baseContentView, flashContentView],
    total: 2,
  });

  const executor = new AIToolExecutor({
    createFlashContentUseCase: createFlashContent as never,
    createTextContentUseCase: noopUseCase as never,
    updateContentUseCase: updateContent as never,
    deleteContentUseCase: deleteContent as never,
    createPlaylistUseCase: createPlaylist as never,
    updatePlaylistUseCase: updatePlaylist as never,
    deletePlaylistUseCase: deletePlaylist as never,
    replacePlaylistItemsAtomicUseCase: noopUseCase as never,
    createScheduleUseCase: createSchedule as never,
    updateScheduleUseCase: updateSchedule as never,
    deleteScheduleUseCase: deleteSchedule as never,
    listDisplaysUseCase: {
      execute: async () => ({ items: [], total: 0 }),
    } as never,
    listContentUseCase: listContent as never,
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
    createFlashContent,
    updateContent,
    deleteContent,
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
    createSchedule,
    createdSchedules,
    updateSchedule,
    deleteSchedule,
    listContent,
  };
};

// Valid UUIDs required by the tool input schemas (fourth group must start with [89ab])
const CONTENT_ID = "550e8400-e29b-41d4-a716-446655440001";
const PLAYLIST_ID = "550e8400-e29b-41d4-a716-446655440002";
const SCHEDULE_ID = "550e8400-e29b-41d4-a716-446655440003";
const SCHEDULE_ID_2 = "550e8400-e29b-41d4-a716-446655440004";
const DISPLAY_ID = "550e8400-e29b-41d4-a716-446655440005";
const DISPLAY_ID_2 = "550e8400-e29b-41d4-a716-446655440006";

const ctx = { userId: "user-42", conversationId: "conv-1" };

describe("AIToolExecutor – edit/delete ownership routing", () => {
  describe("create_flash_content", () => {
    test("maps message to the flash content use case", async () => {
      const { executor, createFlashContent } = makeDeps();
      const result = await executor.execute(
        {
          id: "tc-create-flash",
          toolName: "create_flash_content",
          args: {
            title: "Weather Alert",
            message: "Heavy rain expected.",
            tone: "WARNING",
          },
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(createFlashContent.lastInput).toMatchObject({
        title: "Weather Alert",
        message: "Heavy rain expected.",
        tone: "WARNING",
        ownerId: "user-42",
      });
    });
  });

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

  describe("edit_flash_content", () => {
    test("passes flash fields to updateContentUseCase", async () => {
      const { executor, updateContent } = makeDeps();
      const result = await executor.execute(
        {
          id: "tc-edit-flash",
          toolName: "edit_flash_content",
          args: {
            contentId: CONTENT_ID,
            title: "Updated Alert",
            message: "Use the main exit.",
            tone: "CRITICAL",
          },
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updateContent.lastInput).toMatchObject({
        id: CONTENT_ID,
        ownerId: "user-42",
        title: "Updated Alert",
        flashMessage: "Use the main exit.",
        flashTone: "CRITICAL",
      });
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

  describe("create_playlist", () => {
    test("passes showCounter and playlist items to createPlaylistUseCase", async () => {
      const { executor, createPlaylist } = makeDeps();
      const result = await executor.execute(
        {
          id: "tc-create-playlist",
          toolName: "create_playlist",
          args: {
            name: "Lobby Loop",
            description: "Morning notices",
            showCounter: true,
            items: [{ contentId: CONTENT_ID, duration: 10 }],
          },
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(createPlaylist.lastInput).toMatchObject({
        name: "Lobby Loop",
        description: "Morning notices",
        showCounter: true,
        ownerId: "user-42",
        items: [{ contentId: CONTENT_ID, duration: 10 }],
      });
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

    test("passes showCounter to updatePlaylistUseCase", async () => {
      const { executor, updatePlaylist } = makeDeps();
      const result = await executor.execute(
        {
          id: "tc-edit-playlist-counter",
          toolName: "edit_playlist",
          args: { playlistId: PLAYLIST_ID, showCounter: true },
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updatePlaylist.lastInput).toMatchObject({
        id: PLAYLIST_ID,
        ownerId: "user-42",
        showCounter: true,
      });
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

  describe("create_schedule", () => {
    test("creates one playlist schedule per target display", async () => {
      const { executor, createdSchedules } = makeDeps();
      const result = await executor.execute(
        {
          id: "tc-create-schedule",
          toolName: "create_schedule",
          args: {
            playlistId: PLAYLIST_ID,
            name: "Morning Loop",
            displayIds: [DISPLAY_ID, DISPLAY_ID_2],
            startDate: "2027-01-01",
            endDate: "2027-01-01",
            startTime: "08:00",
            endTime: "08:30",
          },
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(createdSchedules).toHaveLength(2);
      expect(createdSchedules[0]).toMatchObject({
        kind: "PLAYLIST",
        playlistId: PLAYLIST_ID,
        contentId: null,
        displayId: DISPLAY_ID,
        ownerId: "user-42",
      });
      expect(createdSchedules[1]).toMatchObject({
        kind: "PLAYLIST",
        displayId: DISPLAY_ID_2,
      });
      expect(result.data).toEqual([
        expect.objectContaining({ displayId: DISPLAY_ID }),
        expect.objectContaining({ displayId: DISPLAY_ID_2 }),
      ]);
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

  describe("create_flash_schedule", () => {
    test("creates one flash schedule per target display", async () => {
      const { executor, createdSchedules } = makeDeps();
      const result = await executor.execute(
        {
          id: "tc-create-flash-schedule",
          toolName: "create_flash_schedule",
          args: {
            contentId: CONTENT_ID,
            name: "Emergency Alert",
            displayIds: [DISPLAY_ID, DISPLAY_ID_2],
            startDate: "2027-01-01",
            endDate: "2027-01-01",
            startTime: "09:00",
            endTime: "09:05",
          },
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(createdSchedules).toHaveLength(2);
      expect(createdSchedules[0]).toMatchObject({
        kind: "FLASH",
        playlistId: null,
        contentId: CONTENT_ID,
        displayId: DISPLAY_ID,
        ownerId: "user-42",
      });
      expect(createdSchedules[1]).toMatchObject({
        kind: "FLASH",
        displayId: DISPLAY_ID_2,
      });
      expect(result.data).toEqual([
        expect.objectContaining({ displayId: DISPLAY_ID }),
        expect.objectContaining({ displayId: DISPLAY_ID_2 }),
      ]);
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

  describe("list_content", () => {
    test("lists only non-flash content for the current user", async () => {
      const { executor, listContent } = makeDeps();
      const result = await executor.execute(
        { id: "tc-list-content", toolName: "list_content", args: {} },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(listContent.lastInput).toMatchObject({
        ownerId: "user-42",
        pageSize: 100,
        status: "READY",
        excludeType: "FLASH",
      });
    });

    test("filters listed non-flash content by search term", async () => {
      const { executor } = makeDeps();
      const result = await executor.execute(
        {
          id: "tc-list-content-search",
          toolName: "list_content",
          args: { search: "test" },
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe("Found 1 content item.");
      expect(result.data).toEqual([
        {
          id: "content-1",
          title: "Test",
          type: "TEXT",
          status: "READY",
          statusLabel: "Draft",
          preview: "Do not leak raw HTML",
        },
      ]);
      expect(JSON.stringify(result.data)).not.toContain("textHtmlContent");
      expect(JSON.stringify(result.data)).not.toContain("checksum");
    });
  });

  describe("list_flash_content", () => {
    test("lists only flash content for the current user", async () => {
      const { executor, listContent } = makeDeps();
      const result = await executor.execute(
        { id: "tc-list-flash", toolName: "list_flash_content", args: {} },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(listContent.lastInput).toMatchObject({
        ownerId: "user-42",
        pageSize: 100,
        status: "READY",
        type: "FLASH",
      });
    });

    test("filters listed flash content by search term", async () => {
      const { executor } = makeDeps();
      const result = await executor.execute(
        {
          id: "tc-list-flash-search",
          toolName: "list_flash_content",
          args: { search: "flash" },
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe("Found 1 flash content item.");
      expect(result.data).toEqual([
        {
          id: "content-2",
          title: "Flash Alert",
          type: "FLASH",
          status: "READY",
          statusLabel: "Draft",
          message: "Alert",
          tone: "WARNING",
        },
      ]);
    });
  });
});
