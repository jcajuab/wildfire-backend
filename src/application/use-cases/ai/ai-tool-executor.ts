import { type z } from "zod";
import {
  type AIToolCall,
  type AIToolResult,
  type AuditLogger,
} from "#/application/ports/ai";
import { type ContentRepository } from "#/application/ports/content";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type CreateFlashContentUseCase } from "#/application/use-cases/content/create-flash-content.use-case";
import { type CreateTextContentUseCase } from "#/application/use-cases/content/create-text-content.use-case";
import { type ListContentUseCase } from "#/application/use-cases/content/list-content.use-case";
import { type ListDisplaysUseCase } from "#/application/use-cases/displays/list-displays.use-case";
import { type CreatePlaylistUseCase } from "#/application/use-cases/playlists/create-playlist.use-case";
import { type ListPlaylistsUseCase } from "#/application/use-cases/playlists/list-playlists.use-case";
import { type ReplacePlaylistItemsAtomicUseCase } from "#/application/use-cases/playlists/replace-playlist-items.use-case";
import { type CreateScheduleUseCase } from "#/application/use-cases/schedules/create-schedule.use-case";
import { type ListSchedulesUseCase } from "#/application/use-cases/schedules/list-schedules.use-case";
import { AI_TOOLS } from "./ai-tool-registry";
import { convertPlainTextToTipTap } from "./tiptap-convert";

/** Fuzzy match: every word in the query must appear somewhere in the text. */
const fuzzyMatch = (text: string, query: string): boolean => {
  const lower = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .every((word) => lower.includes(word));
};

type CreateTextContentArgs = z.infer<
  typeof AI_TOOLS.create_text_content.inputSchema
>;
type CreatePlaylistArgs = z.infer<typeof AI_TOOLS.create_playlist.inputSchema>;
type CreateScheduleArgs = z.infer<typeof AI_TOOLS.create_schedule.inputSchema>;
type CreateFlashScheduleArgs = z.infer<
  typeof AI_TOOLS.create_flash_schedule.inputSchema
>;
type ListDisplaysArgs = z.infer<typeof AI_TOOLS.list_displays.inputSchema>;
type ListContentArgs = z.infer<typeof AI_TOOLS.list_content.inputSchema>;
type CreateFlashContentArgs = z.infer<
  typeof AI_TOOLS.create_flash_content.inputSchema
>;
type ListPlaylistsArgs = z.infer<typeof AI_TOOLS.list_playlists.inputSchema>;
type ListSchedulesArgs = z.infer<typeof AI_TOOLS.list_schedules.inputSchema>;
type EditContentArgs = z.infer<typeof AI_TOOLS.edit_content.inputSchema>;
type DeleteContentArgs = z.infer<typeof AI_TOOLS.delete_content.inputSchema>;
type EditPlaylistArgs = z.infer<typeof AI_TOOLS.edit_playlist.inputSchema>;
type DeletePlaylistArgs = z.infer<typeof AI_TOOLS.delete_playlist.inputSchema>;
type EditScheduleArgs = z.infer<typeof AI_TOOLS.edit_schedule.inputSchema>;
type DeleteScheduleArgs = z.infer<typeof AI_TOOLS.delete_schedule.inputSchema>;
type EditFlashScheduleArgs = z.infer<
  typeof AI_TOOLS.edit_flash_schedule.inputSchema
>;
type DeleteFlashScheduleArgs = z.infer<
  typeof AI_TOOLS.delete_flash_schedule.inputSchema
>;

export class AIToolExecutor {
  constructor(
    private readonly deps: {
      createFlashContentUseCase: CreateFlashContentUseCase;
      createTextContentUseCase: CreateTextContentUseCase;
      createPlaylistUseCase: CreatePlaylistUseCase;
      replacePlaylistItemsAtomicUseCase: ReplacePlaylistItemsAtomicUseCase;
      createScheduleUseCase: CreateScheduleUseCase;
      listDisplaysUseCase: ListDisplaysUseCase;
      listContentUseCase: ListContentUseCase;
      listPlaylistsUseCase: ListPlaylistsUseCase;
      listSchedulesUseCase: ListSchedulesUseCase;
      contentRepository: ContentRepository;
      playlistRepository: PlaylistRepository;
      scheduleRepository: ScheduleRepository;
      auditLogger: AuditLogger;
    },
  ) {}

  async execute(
    toolCall: AIToolCall,
    context: { userId: string; conversationId: string },
  ): Promise<AIToolResult> {
    const toolDef = AI_TOOLS[toolCall.toolName as keyof typeof AI_TOOLS];
    if (!toolDef) {
      return { success: false, error: `Unknown tool: ${toolCall.toolName}` };
    }

    try {
      const parseResult = toolDef.inputSchema.safeParse(toolCall.args);
      if (!parseResult.success) {
        return {
          success: false,
          error: `Invalid parameters: ${parseResult.error.message}`,
        };
      }

      const result = await this.executeDirectly(
        toolCall.toolName,
        parseResult.data as Record<string, unknown>,
        context,
      );

      this.deps.auditLogger.log({
        event: "ai.tool.executed",
        userId: context.userId,
        metadata: { toolName: toolCall.toolName, success: result.success },
      });

      return result;
    } catch (error) {
      this.deps.auditLogger.log({
        event: "ai.tool.error",
        userId: context.userId,
        metadata: {
          toolName: toolCall.toolName,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Tool execution failed",
      };
    }
  }

  private async executeDirectly(
    toolName: string,
    args: Record<string, unknown>,
    context: { userId: string },
  ): Promise<AIToolResult> {
    switch (toolName) {
      case "create_text_content": {
        const typedArgs = args as CreateTextContentArgs;
        const { jsonContent, htmlContent } = convertPlainTextToTipTap(
          typedArgs.text,
        );
        const result = await this.deps.createTextContentUseCase.execute({
          title: typedArgs.title,
          jsonContent,
          htmlContent,
          ownerId: context.userId,
        });
        return { success: true, data: result };
      }

      case "create_flash_content": {
        const typedArgs = args as CreateFlashContentArgs;
        const result = await this.deps.createFlashContentUseCase.execute({
          title: typedArgs.title,
          message: typedArgs.text,
          tone: typedArgs.tone,
          ownerId: context.userId,
        });
        return { success: true, data: result };
      }

      case "create_playlist": {
        const typedArgs = args as CreatePlaylistArgs;
        const result = await this.deps.createPlaylistUseCase.execute({
          name: typedArgs.name,
          description: typedArgs.description,
          ownerId: context.userId,
        });

        if (typedArgs.items?.length) {
          const playlistItems =
            await this.deps.replacePlaylistItemsAtomicUseCase.execute({
              ownerId: context.userId,
              playlistId: result.id,
              items: typedArgs.items.map((item) => ({
                kind: "new",
                contentId: item.contentId,
                duration: item.duration,
              })),
            });

          return {
            success: true,
            data: {
              ...result,
              itemsCount: playlistItems.length,
              totalDuration: playlistItems.reduce(
                (sum, playlistItem) => sum + playlistItem.duration,
                0,
              ),
            },
          };
        }

        return { success: true, data: result };
      }

      case "create_schedule": {
        const typedArgs = args as CreateScheduleArgs;
        const result = await this.deps.createScheduleUseCase.execute({
          name: typedArgs.name,
          kind: "PLAYLIST",
          playlistId: typedArgs.playlistId,
          contentId: null,
          displayId: typedArgs.displayId,
          startDate: typedArgs.startDate,
          endDate: typedArgs.endDate,
          startTime: typedArgs.startTime,
          endTime: typedArgs.endTime,
          ownerId: context.userId,
        });
        return { success: true, data: result };
      }

      case "create_flash_schedule": {
        const typedArgs = args as CreateFlashScheduleArgs;
        const result = await this.deps.createScheduleUseCase.execute({
          name: typedArgs.name,
          kind: "FLASH",
          playlistId: null,
          contentId: typedArgs.contentId,
          displayId: typedArgs.displayId,
          startDate: typedArgs.startDate,
          endDate: typedArgs.endDate,
          startTime: typedArgs.startTime,
          endTime: typedArgs.endTime,
          ownerId: context.userId,
        });
        return { success: true, data: result };
      }

      case "list_displays": {
        const typedArgs = args as ListDisplaysArgs;
        const result = await this.deps.listDisplaysUseCase.execute({
          pageSize: 100,
        });
        const items = typedArgs.search
          ? result.items.filter((d) => fuzzyMatch(d.name, typedArgs.search!))
          : result.items;
        return { success: true, data: items };
      }

      case "list_content": {
        const typedArgs = args as ListContentArgs;
        const result = await this.deps.listContentUseCase.execute({
          ownerId: context.userId,
          pageSize: 100,
        });
        const items = typedArgs.search
          ? result.items.filter((c) => fuzzyMatch(c.title, typedArgs.search!))
          : result.items;
        return { success: true, data: items };
      }

      case "list_playlists": {
        const typedArgs = args as ListPlaylistsArgs;
        const result = await this.deps.listPlaylistsUseCase.execute({
          ownerId: context.userId,
          pageSize: 100,
        });
        const items = typedArgs.search
          ? result.items.filter((p) => fuzzyMatch(p.name, typedArgs.search!))
          : result.items;
        return { success: true, data: items };
      }

      case "list_schedules": {
        const typedArgs = args as ListSchedulesArgs;
        const result = await this.deps.listSchedulesUseCase.execute({
          ownerId: context.userId,
          pageSize: 100,
        });
        const items = typedArgs.search
          ? result.items.filter((s) => fuzzyMatch(s.name, typedArgs.search!))
          : result.items;
        return { success: true, data: items };
      }

      case "edit_content": {
        const typedArgs = args as EditContentArgs;
        const converted = typedArgs.text
          ? convertPlainTextToTipTap(typedArgs.text)
          : undefined;
        const updated = await this.deps.contentRepository.update(
          typedArgs.contentId,
          {
            title: typedArgs.title,
            textJsonContent: converted?.jsonContent,
            textHtmlContent: converted?.htmlContent,
          },
        );
        return { success: true, data: updated };
      }

      case "delete_content": {
        const typedArgs = args as DeleteContentArgs;
        await this.deps.contentRepository.delete(typedArgs.contentId);
        return { success: true, data: { deleted: true } };
      }

      case "edit_playlist": {
        const typedArgs = args as EditPlaylistArgs;
        const updated = await this.deps.playlistRepository.update(
          typedArgs.playlistId,
          {
            name: typedArgs.name,
            description: typedArgs.description,
          },
        );

        if (typedArgs.items?.length) {
          await this.deps.replacePlaylistItemsAtomicUseCase.execute({
            ownerId: context.userId,
            playlistId: typedArgs.playlistId,
            items: typedArgs.items.map((item) => ({
              kind: "new",
              contentId: item.contentId,
              duration: item.duration,
            })),
          });
        }

        return { success: true, data: updated };
      }

      case "delete_playlist": {
        const typedArgs = args as DeletePlaylistArgs;
        await this.deps.playlistRepository.delete(typedArgs.playlistId);
        return { success: true, data: { deleted: true } };
      }

      case "edit_schedule": {
        const typedArgs = args as EditScheduleArgs;
        const updated = await this.deps.scheduleRepository.update(
          typedArgs.scheduleId,
          {
            name: typedArgs.name,
            playlistId: typedArgs.playlistId,
            displayId: typedArgs.displayId,
            startDate: typedArgs.startDate,
            endDate: typedArgs.endDate,
            startTime: typedArgs.startTime,
            endTime: typedArgs.endTime,
          },
        );
        return { success: true, data: updated };
      }

      case "delete_schedule": {
        const typedArgs = args as DeleteScheduleArgs;
        await this.deps.scheduleRepository.delete(typedArgs.scheduleId);
        return { success: true, data: { deleted: true } };
      }

      case "edit_flash_schedule": {
        const typedArgs = args as EditFlashScheduleArgs;
        const updated = await this.deps.scheduleRepository.update(
          typedArgs.scheduleId,
          {
            name: typedArgs.name,
            contentId: typedArgs.contentId,
            displayId: typedArgs.displayId,
            startDate: typedArgs.startDate,
            endDate: typedArgs.endDate,
            startTime: typedArgs.startTime,
            endTime: typedArgs.endTime,
          },
        );
        return { success: true, data: updated };
      }

      case "delete_flash_schedule": {
        const typedArgs = args as DeleteFlashScheduleArgs;
        await this.deps.scheduleRepository.delete(typedArgs.scheduleId);
        return { success: true, data: { deleted: true } };
      }

      default:
        return { success: false, error: `Tool not implemented: ${toolName}` };
    }
  }
}
