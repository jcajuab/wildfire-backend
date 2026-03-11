import {
  type AIToolCall,
  type AIToolResult,
  type AuditLogger,
  type PendingActionStore,
} from "#/application/ports/ai";
import { type CreateTextContentUseCase } from "#/application/use-cases/content/create-text-content.use-case";
import { type CreatePlaylistUseCase } from "#/application/use-cases/playlists/playlist.use-cases";
import { type CreateScheduleUseCase } from "#/application/use-cases/schedules/schedule.use-cases";
import { AI_TOOLS } from "./ai-tool-registry";

export class AIToolExecutor {
  constructor(
    private readonly deps: {
      createTextContentUseCase: CreateTextContentUseCase;
      createPlaylistUseCase: CreatePlaylistUseCase;
      createScheduleUseCase: CreateScheduleUseCase;
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
      const parseResult = toolDef.parameters.safeParse(toolCall.args);
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
        const result = await this.deps.createTextContentUseCase.execute({
          title: args.title as string,
          jsonContent: args.jsonContent as string,
          htmlContent: args.htmlContent as string,
          ownerId: context.userId,
        });
        return { success: true, data: result };
      }

      case "create_playlist": {
        const result = await this.deps.createPlaylistUseCase.execute({
          name: args.name as string,
          description: args.description as string | undefined,
          ownerId: context.userId,
        });
        return { success: true, data: result };
      }

      case "create_schedule": {
        const result = await this.deps.createScheduleUseCase.execute({
          name: args.name as string,
          kind: args.kind as "PLAYLIST" | "FLASH",
          playlistId: (args.playlistId as string | undefined) ?? null,
          contentId: (args.contentId as string | undefined) ?? null,
          displayId: args.displayId as string,
          startDate: args.startDate as string | undefined,
          endDate: args.endDate as string | undefined,
          startTime: args.startTime as string,
          endTime: args.endTime as string,
          isActive: args.isActive as boolean,
          ownerId: context.userId,
        });
        return { success: true, data: result };
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
