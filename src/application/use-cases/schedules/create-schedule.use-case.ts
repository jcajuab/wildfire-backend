import { ValidationError } from "#/application/errors/validation";
import {
  type AdminDisplayLifecycleEventPublisher,
  type DisplayStreamEventPublisher,
} from "#/application/ports/display-stream-events";
import { type ScheduleKind } from "#/application/ports/schedules";
import { computeRequiredMinPlaylistDurationSeconds } from "#/application/use-cases/shared/playlist-required-duration";
import { NotFoundError } from "./errors";
import { toScheduleView } from "./schedule-view";
import {
  computeWindowDurationSeconds,
  DEFAULT_SCHEDULE_TIMEZONE,
  ensureFlashContentIsSchedulable,
  ensureNoScheduleConflicts,
  getValidatedWindow,
  type ScheduleMutationDeps,
  toScheduleWindow,
} from "./shared";

export class CreateScheduleUseCase {
  constructor(
    private readonly deps: ScheduleMutationDeps & {
      displayEventPublisher?: DisplayStreamEventPublisher;
      adminLifecycleEventPublisher?: AdminDisplayLifecycleEventPublisher;
    },
  ) {}

  async execute(input: {
    ownerId?: string;
    name: string;
    kind: ScheduleKind;
    playlistId: string | null;
    contentId: string | null;
    displayId: string;
    startDate?: string;
    endDate?: string;
    startTime: string;
    endTime: string;
  }) {
    const { startDate, endDate } = getValidatedWindow(input);

    if (input.startDate && input.startTime) {
      const startDateTimeStr = `${startDate}T${input.startTime}`;
      const nowInTimezone = new Date(
        new Date().toLocaleString("en-US", {
          timeZone: this.deps.timezone ?? DEFAULT_SCHEDULE_TIMEZONE,
        }),
      );
      const startLocal = new Date(startDateTimeStr);
      const fiveMinutesMs = 5 * 60 * 1000;
      if (startLocal.getTime() < nowInTimezone.getTime() - fiveMinutesMs) {
        throw new ValidationError("Schedule start time cannot be in the past.");
      }
    }
    const display = await this.deps.displayRepository.findById(input.displayId);
    if (!display) {
      throw new NotFoundError("Display not found");
    }

    let playlist = null;
    let content = null;
    if (input.kind === "PLAYLIST") {
      if (!input.playlistId || input.contentId) {
        throw new ValidationError("Playlist schedules require playlistId only");
      }
      playlist =
        input.ownerId && this.deps.playlistRepository.findByIdForOwner
          ? await this.deps.playlistRepository.findByIdForOwner(
              input.playlistId,
              input.ownerId,
            )
          : await this.deps.playlistRepository.findById(input.playlistId);
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
          playlistId: input.playlistId,
        });
      const windowDurationSeconds = computeWindowDurationSeconds(
        input.startTime,
        input.endTime,
      );
      if (windowDurationSeconds < requiredMinDurationSeconds) {
        throw new ValidationError(
          `Schedule window is too short. Required minimum is ${requiredMinDurationSeconds} seconds.`,
        );
      }
    } else {
      if (!input.contentId || input.playlistId) {
        throw new ValidationError("Flash schedules require contentId only");
      }
      content =
        input.ownerId && this.deps.contentRepository.findByIdForOwner
          ? await this.deps.contentRepository.findByIdForOwner(
              input.contentId,
              input.ownerId,
            )
          : await this.deps.contentRepository.findById(input.contentId);
      if (!content) {
        throw new NotFoundError("Content not found");
      }
      ensureFlashContentIsSchedulable(content);
    }

    const candidate = toScheduleWindow({
      name: input.name.trim(),
      kind: input.kind,
      playlistId: input.kind === "PLAYLIST" ? input.playlistId : null,
      contentId: input.kind === "FLASH" ? input.contentId : null,
      displayId: input.displayId,
      startDate,
      endDate,
      startTime: input.startTime,
      endTime: input.endTime,
    });
    ensureNoScheduleConflicts({
      candidate,
      existing: (
        await this.deps.scheduleRepository.listByDisplay(input.displayId)
      ).map(toScheduleWindow),
    });

    if (!input.ownerId) {
      throw new ValidationError("ownerId is required to create a schedule");
    }

    const schedule = await this.deps.scheduleRepository.create({
      name: candidate.name,
      kind: candidate.kind,
      playlistId: candidate.playlistId,
      contentId: candidate.contentId,
      displayId: candidate.displayId,
      createdBy: input.ownerId,
      startDate: candidate.startDate,
      endDate: candidate.endDate,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
    });

    if (playlist) {
      await this.deps.playlistRepository.updateStatus(playlist.id, "IN_USE");
      this.deps.adminLifecycleEventPublisher?.publish({
        type: "playlist_status_changed",
        playlistId: playlist.id,
        status: "IN_USE",
        occurredAt: new Date().toISOString(),
      });
    }
    this.deps.displayEventPublisher?.publish({
      type: "schedule_updated",
      displayId: input.displayId,
      reason: "schedule_created",
    });

    return toScheduleView(schedule, playlist, content, display);
  }
}
