import { type z } from "zod";
import {
  type AIToolCall,
  type AIToolResult,
  type AuditLogger,
  type PendingActionStore,
} from "#/application/ports/ai";
import { type CreateFlashContentUseCase } from "#/application/use-cases/content/create-flash-content.use-case";
import { type CreateTextContentUseCase } from "#/application/use-cases/content/create-text-content.use-case";
import { type ListContentUseCase } from "#/application/use-cases/content/list-content.use-case";
import { type ListDisplaysUseCase } from "#/application/use-cases/displays/list-displays.use-case";
import { type CreatePlaylistUseCase } from "#/application/use-cases/playlists/create-playlist.use-case";
import { type ListPlaylistsUseCase } from "#/application/use-cases/playlists/list-playlists.use-case";
import { type ReplacePlaylistItemsAtomicUseCase } from "#/application/use-cases/playlists/replace-playlist-items.use-case";
import { type CreateScheduleUseCase } from "#/application/use-cases/schedules/create-schedule.use-case";
import { AI_TOOLS } from "./ai-tool-registry";
import { convertPlainTextToTipTap } from "./tiptap-convert";

type CreateTextContentArgs = z.infer<
  typeof AI_TOOLS.create_text_content.inputSchema
>;
type CreatePlaylistArgs = z.infer<typeof AI_TOOLS.create_playlist.inputSchema>;
type CreateScheduleArgs = z.infer<typeof AI_TOOLS.create_schedule.inputSchema>;
type ListDisplaysArgs = z.infer<typeof AI_TOOLS.list_displays.inputSchema>;
type ListContentArgs = z.infer<typeof AI_TOOLS.list_content.inputSchema>;
type CreateFlashContentArgs = z.infer<
  typeof AI_TOOLS.create_flash_content.inputSchema
>;
type ListPlaylistsArgs = z.infer<typeof AI_TOOLS.list_playlists.inputSchema>;

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
      pendingActionStore: PendingActionStore;
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

      if (toolDef.requiresConfirmation) {
        return this.createPendingAction(
          toolCall,
          context,
          parseResult.data as Record<string, unknown>,
        );
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
          kind: typedArgs.kind,
          playlistId: typedArgs.playlistId ?? null,
          contentId: typedArgs.contentId ?? null,
          displayId: typedArgs.displayId,
          startDate: typedArgs.startDate,
          endDate: typedArgs.endDate,
          startTime: typedArgs.startTime,
          endTime: typedArgs.endTime,
          isActive: typedArgs.isActive,
          ownerId: context.userId,
        });
        return { success: true, data: result };
      }

      case "list_displays": {
        const typedArgs = args as ListDisplaysArgs;
        const result = await this.deps.listDisplaysUseCase.execute({
          q: typedArgs.search,
          pageSize: 100,
        });
        return { success: true, data: result.items };
      }

      case "list_content": {
        const typedArgs = args as ListContentArgs;
        const result = await this.deps.listContentUseCase.execute({
          ownerId: context.userId,
          search: typedArgs.search,
          pageSize: 100,
        });
        return { success: true, data: result.items };
      }

      case "list_playlists": {
        const typedArgs = args as ListPlaylistsArgs;
        const result = await this.deps.listPlaylistsUseCase.execute({
          ownerId: context.userId,
          search: typedArgs.search,
          pageSize: 100,
        });
        return { success: true, data: result.items };
      }

      default:
        return { success: false, error: `Tool not implemented: ${toolName}` };
    }
  }

  private async createPendingAction(
    toolCall: AIToolCall,
    context: { userId: string; conversationId: string },
    args: Record<string, unknown>,
  ): Promise<AIToolResult> {
    const actionType = toolCall.toolName.startsWith("delete_")
      ? "delete"
      : "edit";
    const resourceType = toolCall.toolName.replace(/^(edit_|delete_)/, "") as
      | "content"
      | "playlist"
      | "schedule";
    const resourceId = (args.contentId ??
      args.playlistId ??
      args.scheduleId) as string;

    const pending = await this.deps.pendingActionStore.create({
      conversationId: context.conversationId,
      userId: context.userId,
      actionType,
      resourceType,
      resourceId,
      payload: args,
      summary: `${actionType} ${resourceType} ${resourceId}`,
    });

    this.deps.auditLogger.log({
      event: "ai.action.pending",
      userId: context.userId,
      metadata: {
        token: pending.token,
        actionType,
        resourceType,
        resourceId,
      },
    });

    return {
      success: true,
      requiresConfirmation: true,
      confirmationToken: pending.token,
      confirmationSummary: pending.summary,
    };
  }
}
