import { NotFoundError } from "#/application/errors/not-found";
import {
  type AICredentialsRepository,
  type AuditLogger,
  type PendingAction,
  type PendingActionStore,
} from "#/application/ports/ai";
import { type ContentRepository } from "#/application/ports/content";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { type ReplacePlaylistItemsAtomicUseCase } from "#/application/use-cases/playlists/replace-playlist-items.use-case";
import { type AIKeyEncryptionService } from "#/infrastructure/crypto/ai-key-encryption.service";
import { convertPlainTextToTipTap } from "./tiptap-convert";

export interface AIConfirmDeps {
  pendingActionStore: PendingActionStore;
  credentialsRepository: AICredentialsRepository;
  encryptionService: AIKeyEncryptionService;
  contentRepository: ContentRepository;
  playlistRepository: PlaylistRepository;
  replacePlaylistItemsAtomicUseCase: ReplacePlaylistItemsAtomicUseCase;
  scheduleRepository: ScheduleRepository;
  auditLogger: AuditLogger;
}

export class AIConfirmActionUseCase {
  constructor(private readonly deps: AIConfirmDeps) {}

  async execute(input: {
    token: string;
    conversationId: string;
    userId: string;
    approved: boolean;
  }): Promise<{ success: boolean; message: string; data?: unknown }> {
    const action = await this.deps.pendingActionStore.get(
      input.token,
      input.userId,
      input.conversationId,
    );

    if (!action) {
      throw new NotFoundError("Pending action not found or expired");
    }

    if (!input.approved) {
      await this.deps.pendingActionStore.delete(input.token);
      this.deps.auditLogger.log({
        event: "ai.action.rejected",
        userId: input.userId,
        metadata: {
          token: input.token,
          actionType: action.actionType,
          resourceType: action.resourceType,
          resourceId: action.resourceId,
        },
      });
      return { success: true, message: "Action rejected" };
    }

    const result = await this.executeApprovedAction(action, input.userId);

    await this.deps.pendingActionStore.delete(input.token);

    this.deps.auditLogger.log({
      event: "ai.action.confirmed",
      userId: input.userId,
      metadata: {
        token: input.token,
        actionType: action.actionType,
        resourceType: action.resourceType,
        resourceId: action.resourceId,
      },
    });

    return { success: true, message: "Action executed", data: result };
  }

  private async executeApprovedAction(
    action: PendingAction,
    userId: string,
  ): Promise<unknown> {
    switch (`${action.actionType}_${action.resourceType}`) {
      case "edit_content": {
        const payload = action.payload as {
          title?: string;
          text?: string;
        };
        const converted = payload.text
          ? convertPlainTextToTipTap(payload.text)
          : undefined;
        const updated = await this.deps.contentRepository.update(
          action.resourceId,
          {
            title: payload.title,
            textJsonContent: converted?.jsonContent,
            textHtmlContent: converted?.htmlContent,
          },
        );
        return updated;
      }

      case "delete_content": {
        await this.deps.contentRepository.delete(action.resourceId);
        return { deleted: true };
      }

      case "edit_playlist": {
        const payload = action.payload as {
          name?: string;
          description?: string | null;
          items?: Array<{ contentId: string; duration: number }>;
        };
        const updated = await this.deps.playlistRepository.update(
          action.resourceId,
          {
            name: payload.name,
            description: payload.description,
          },
        );

        if (payload.items?.length) {
          await this.deps.replacePlaylistItemsAtomicUseCase.execute({
            ownerId: userId,
            playlistId: action.resourceId,
            items: payload.items.map((item) => ({
              kind: "new",
              contentId: item.contentId,
              duration: item.duration,
            })),
          });
        }

        return updated;
      }

      case "delete_playlist": {
        await this.deps.playlistRepository.delete(action.resourceId);
        return { deleted: true };
      }

      case "edit_schedule": {
        const payload = action.payload as {
          name?: string;
          kind?: "PLAYLIST" | "FLASH";
          playlistId?: string;
          contentId?: string;
          displayId?: string;
          startDate?: string;
          endDate?: string;
          startTime?: string;
          endTime?: string;
          isActive?: boolean;
        };
        const updated = await this.deps.scheduleRepository.update(
          action.resourceId,
          {
            name: payload.name,
            kind: payload.kind,
            playlistId: payload.playlistId,
            contentId: payload.contentId,
            displayId: payload.displayId,
            startDate: payload.startDate,
            endDate: payload.endDate,
            startTime: payload.startTime,
            endTime: payload.endTime,
            isActive: payload.isActive,
          },
        );
        return updated;
      }

      case "delete_schedule": {
        await this.deps.scheduleRepository.delete(action.resourceId);
        return { deleted: true };
      }

      default:
        throw new NotFoundError(
          `Unsupported action: ${action.actionType} ${action.resourceType}`,
        );
    }
  }
}

export class CancelPendingActionUseCase {
  constructor(
    private readonly deps: {
      pendingActionStore: PendingActionStore;
      auditLogger: AuditLogger;
    },
  ) {}

  async execute(input: { token: string; userId: string }): Promise<void> {
    const deleted = await this.deps.pendingActionStore.delete(input.token);

    if (!deleted) {
      throw new NotFoundError("Pending action not found");
    }

    this.deps.auditLogger.log({
      event: "ai.action.cancelled",
      userId: input.userId,
      metadata: { token: input.token },
    });
  }
}

export class ListPendingActionsUseCase {
  constructor(
    private readonly deps: {
      pendingActionStore: PendingActionStore;
    },
  ) {}

  async execute(userId: string) {
    return this.deps.pendingActionStore.listForUser(userId);
  }
}
