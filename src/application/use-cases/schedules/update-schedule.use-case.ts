import { ValidationError } from "#/application/errors/validation";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type ScheduleKind } from "#/application/ports/schedules";
import { DEFAULT_SCROLL_PX_PER_SECOND } from "#/application/use-cases/shared/playlist-effective-duration";
import { computeRequiredMinPlaylistDurationSeconds } from "#/application/use-cases/shared/playlist-required-duration";
import { NotFoundError } from "./errors";
import { toScheduleView } from "./schedule-view";
import {
  computeWindowDurationSeconds,
  ensureFlashContentIsSchedulable,
  ensureNoScheduleConflicts,
  ensureScheduleVisibleToOwner,
  getValidatedWindow,
  type ScheduleMutationDeps,
  toScheduleWindow,
} from "./shared";

export class UpdateScheduleUseCase {
  constructor(
    private readonly deps: ScheduleMutationDeps & {
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: {
    id: string;
    ownerId?: string;
    name?: string;
    kind?: ScheduleKind;
    playlistId?: string | null;
    contentId?: string | null;
    displayId?: string;
    startDate?: string;
    endDate?: string;
    startTime?: string;
    endTime?: string;
    isActive?: boolean;
  }) {
    const existing = await this.deps.scheduleRepository.findById(input.id);
    if (!existing) throw new NotFoundError("Schedule not found");
    await ensureScheduleVisibleToOwner({
      ownerId: input.ownerId,
      schedule: existing,
      playlistRepository: this.deps.playlistRepository,
      contentRepository: this.deps.contentRepository,
    });

    const nextKind = input.kind ?? existing.kind;
    const nextWindow = getValidatedWindow({
      startDate: input.startDate ?? existing.startDate,
      endDate: input.endDate ?? existing.endDate,
      startTime: input.startTime ?? existing.startTime,
      endTime: input.endTime ?? existing.endTime,
    });
    const nextDisplayId = input.displayId ?? existing.displayId;
    const nextPlaylistId =
      input.playlistId === undefined ? existing.playlistId : input.playlistId;
    const nextContentId =
      input.contentId === undefined ? existing.contentId : input.contentId;
    const nextName = input.name?.trim() ?? existing.name;

    const display = await this.deps.displayRepository.findById(nextDisplayId);
    if (!display) {
      throw new NotFoundError("Display not found");
    }

    let playlist = null;
    let content = null;
    if (nextKind === "PLAYLIST") {
      if (!nextPlaylistId || nextContentId) {
        throw new ValidationError("Playlist schedules require playlistId only");
      }
      playlist =
        input.ownerId && this.deps.playlistRepository.findByIdForOwner
          ? await this.deps.playlistRepository.findByIdForOwner(
              nextPlaylistId,
              input.ownerId,
            )
          : await this.deps.playlistRepository.findById(nextPlaylistId);
      if (!playlist) {
        throw new NotFoundError("Playlist not found");
      }
      if (
        typeof display.screenWidth !== "number" ||
        typeof display.screenHeight !== "number"
      ) {
        throw new ValidationError(
          "Display resolution is required before scheduling",
        );
      }
      const requiredMinDurationSeconds =
        await computeRequiredMinPlaylistDurationSeconds({
          playlistRepository: this.deps.playlistRepository,
          contentRepository: this.deps.contentRepository,
          playlistId: nextPlaylistId,
          displayWidth: display.screenWidth,
          displayHeight: display.screenHeight,
          scrollPxPerSecond: DEFAULT_SCROLL_PX_PER_SECOND,
        });
      const windowDurationSeconds = computeWindowDurationSeconds(
        input.startTime ?? existing.startTime,
        input.endTime ?? existing.endTime,
      );
      if (windowDurationSeconds < requiredMinDurationSeconds) {
        throw new ValidationError(
          `Schedule window is too short. Required minimum is ${requiredMinDurationSeconds} seconds.`,
        );
      }
    } else {
      if (!nextContentId || nextPlaylistId) {
        throw new ValidationError("Flash schedules require contentId only");
      }
      content =
        input.ownerId && this.deps.contentRepository.findByIdForOwner
          ? await this.deps.contentRepository.findByIdForOwner(
              nextContentId,
              input.ownerId,
            )
          : await this.deps.contentRepository.findById(nextContentId);
      if (!content) {
        throw new NotFoundError("Content not found");
      }
      ensureFlashContentIsSchedulable(content);
    }

    const candidate = toScheduleWindow({
      id: existing.id,
      name: nextName,
      kind: nextKind,
      playlistId: nextKind === "PLAYLIST" ? nextPlaylistId : null,
      contentId: nextKind === "FLASH" ? nextContentId : null,
      displayId: nextDisplayId,
      startDate: nextWindow.startDate,
      endDate: nextWindow.endDate,
      startTime: input.startTime ?? existing.startTime,
      endTime: input.endTime ?? existing.endTime,
    });
    ensureNoScheduleConflicts({
      candidate,
      existing: (
        await this.deps.scheduleRepository.listByDisplay(nextDisplayId)
      ).map(toScheduleWindow),
      excludeScheduleIds: new Set([existing.id]),
    });

    const schedule = await this.deps.scheduleRepository.update(input.id, {
      name: nextName,
      kind: nextKind,
      playlistId: candidate.playlistId,
      contentId: candidate.contentId,
      displayId: nextDisplayId,
      startDate: candidate.startDate,
      endDate: candidate.endDate,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      isActive: input.isActive,
    });
    if (!schedule) {
      throw new NotFoundError("Schedule not found");
    }

    if (existing.playlistId && existing.playlistId !== schedule.playlistId) {
      const remaining = await this.deps.scheduleRepository.countByPlaylistId(
        existing.playlistId,
      );
      if (remaining === 0) {
        await this.deps.playlistRepository.updateStatus(
          existing.playlistId,
          "DRAFT",
        );
      }
    }
    if (schedule.playlistId) {
      await this.deps.playlistRepository.updateStatus(
        schedule.playlistId,
        "IN_USE",
      );
    }
    this.deps.displayEventPublisher?.publish({
      type: "schedule_updated",
      displayId: schedule.displayId,
      reason: "schedule_updated",
    });

    return toScheduleView(schedule, playlist, content, display);
  }
}
