import { ValidationError } from "#/application/errors/validation";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type UserRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { sha256Hex } from "#/domain/content/checksum";
import { type ContentStatus } from "#/domain/content/content";
import { toContentView } from "./content-view";
import { NotFoundError } from "./errors";

export class UpdateContentUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      contentStorage?: ContentStorage;
      scheduleRepository?: ScheduleRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: {
    id: string;
    title?: string;
    status?: ContentStatus;
    flashMessage?: string;
    flashTone?: "INFO" | "WARNING" | "CRITICAL";
  }) {
    if (
      input.title === undefined &&
      input.status === undefined &&
      input.flashMessage === undefined &&
      input.flashTone === undefined
    ) {
      throw new ValidationError("At least one field must be provided");
    }
    const existing = await this.deps.contentRepository.findById(input.id);
    if (!existing) {
      throw new NotFoundError("Content not found");
    }

    const nextTitle = input.title?.trim();
    if (existing.type !== "FLASH") {
      if (input.flashMessage !== undefined || input.flashTone !== undefined) {
        throw new ValidationError(
          "Flash fields can only be updated on FLASH content",
        );
      }
    }

    let checksum = existing.checksum;
    let fileSize = existing.fileSize;
    let flashMessage = existing.flashMessage ?? null;
    let flashTone = existing.flashTone ?? null;

    if (existing.type === "FLASH") {
      flashMessage =
        input.flashMessage === undefined
          ? (existing.flashMessage ?? null)
          : input.flashMessage.trim();
      flashTone = input.flashTone ?? existing.flashTone ?? null;
      if (!flashMessage || flashMessage.length > 240 || !flashTone) {
        throw new ValidationError(
          "Flash content requires a message between 1 and 240 characters and a tone",
        );
      }
      const body = new TextEncoder().encode(flashMessage);
      checksum = await sha256Hex(
        new TextEncoder().encode(
          JSON.stringify({ message: flashMessage, tone: flashTone }),
        ).buffer,
      );
      fileSize = body.byteLength;
      await this.deps.contentStorage?.upload({
        key: existing.fileKey,
        body,
        contentType: "text/plain; charset=utf-8",
        contentLength: body.byteLength,
      });
    }

    const updated = await this.deps.contentRepository.update(input.id, {
      title: nextTitle,
      status: input.status,
      flashMessage,
      flashTone,
      checksum,
      fileSize,
    });
    if (!updated) {
      throw new NotFoundError("Content not found");
    }

    if (updated.type === "FLASH" && this.deps.scheduleRepository) {
      const schedules =
        (await this.deps.scheduleRepository.listByContentId?.(updated.id)) ??
        [];
      for (const schedule of schedules) {
        this.deps.displayEventPublisher?.publish({
          type: "manifest_updated",
          displayId: schedule.displayId,
          reason: "flash_content_updated",
        });
      }
    }

    const user = await this.deps.userRepository.findById(updated.createdById);
    return toContentView(updated, user?.name ?? null);
  }
}
