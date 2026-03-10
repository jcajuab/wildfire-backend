import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import {
  type ScheduleKind,
  type ScheduleRecord,
  type ScheduleRepository,
} from "#/application/ports/schedules";
import { paginate } from "#/application/use-cases/shared/pagination";
import { DEFAULT_SCROLL_PX_PER_SECOND } from "#/application/use-cases/shared/playlist-effective-duration";
import { computeRequiredMinPlaylistDurationSeconds } from "#/application/use-cases/shared/playlist-required-duration";
import {
  isValidDate,
  isValidTime,
  selectActiveScheduleByKind,
} from "#/domain/schedules/schedule";
import { NotFoundError, ScheduleConflictError } from "./errors";
import { toScheduleView } from "./schedule-view";

const DEFAULT_SCHEDULE_PRIORITY = 1;
const DAY_SECONDS = 24 * 60 * 60;
const DEFAULT_SCHEDULE_TIMEZONE = "UTC";
const SCHEDULE_OVERLAP_MESSAGE =
  "This schedule overlaps with an existing schedule on the selected display.";

type ScheduleMutationDeps = {
  scheduleRepository: ScheduleRepository;
  playlistRepository: PlaylistRepository;
  displayRepository: DisplayRepository;
  contentRepository: ContentRepository;
  timezone?: string;
};

type ScheduleWindow = {
  id?: string;
  name: string;
  kind: ScheduleKind;
  playlistId: string | null;
  contentId: string | null;
  displayId: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
};

const findPlaylistForOwner = async (
  playlistRepository: PlaylistRepository,
  playlistId: string,
  ownerId?: string,
) => {
  if (ownerId && playlistRepository.findByIdForOwner) {
    return playlistRepository.findByIdForOwner(playlistId, ownerId);
  }
  return playlistRepository.findById(playlistId);
};

const findContentForOwner = async (
  contentRepository: ContentRepository,
  contentId: string,
  ownerId?: string,
) => {
  if (ownerId && contentRepository.findByIdForOwner) {
    return contentRepository.findByIdForOwner(contentId, ownerId);
  }
  return contentRepository.findById(contentId);
};

const ensureScheduleVisibleToOwner = async (input: {
  ownerId?: string;
  schedule: ScheduleRecord;
  playlistRepository: PlaylistRepository;
  contentRepository: ContentRepository;
}) => {
  if (!input.ownerId) {
    return;
  }

  if (input.schedule.playlistId) {
    const ownedPlaylist = await findPlaylistForOwner(
      input.playlistRepository,
      input.schedule.playlistId,
      input.ownerId,
    );
    if (!ownedPlaylist) {
      throw new NotFoundError("Schedule not found");
    }
  }

  if (input.schedule.contentId) {
    const ownedContent = await findContentForOwner(
      input.contentRepository,
      input.schedule.contentId,
      input.ownerId,
    );
    if (!ownedContent) {
      throw new NotFoundError("Schedule not found");
    }
  }
};

const parseTimeToSeconds = (value: string): number => {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number.parseInt(hourRaw ?? "", 10);
  const minute = Number.parseInt(minuteRaw ?? "", 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new ValidationError("Invalid schedule time format");
  }
  return hour * 3600 + minute * 60;
};

const computeWindowDurationSeconds = (startTime: string, endTime: string) => {
  const startSeconds = parseTimeToSeconds(startTime);
  const endSeconds = parseTimeToSeconds(endTime);
  if (endSeconds > startSeconds) {
    return endSeconds - startSeconds;
  }
  if (endSeconds < startSeconds) {
    return DAY_SECONDS - startSeconds + endSeconds;
  }
  return 0;
};

const toDailyTimeSegments = (
  startTime: string,
  endTime: string,
): ReadonlyArray<readonly [number, number]> => {
  const startSeconds = parseTimeToSeconds(startTime);
  const endSeconds = parseTimeToSeconds(endTime);
  if (startSeconds === endSeconds) {
    return [];
  }
  if (startSeconds < endSeconds) {
    return [[startSeconds, endSeconds]];
  }
  return [
    [startSeconds, DAY_SECONDS],
    [0, endSeconds],
  ];
};

const hasDateRangeOverlap = (left: ScheduleWindow, right: ScheduleWindow) =>
  left.startDate <= right.endDate && right.startDate <= left.endDate;

const hasTimeRangeOverlap = (left: ScheduleWindow, right: ScheduleWindow) => {
  const leftSegments = toDailyTimeSegments(left.startTime, left.endTime);
  const rightSegments = toDailyTimeSegments(right.startTime, right.endTime);
  return leftSegments.some(([leftStart, leftEnd]) =>
    rightSegments.some(
      ([rightStart, rightEnd]) => leftStart < rightEnd && rightStart < leftEnd,
    ),
  );
};

const windowsConflict = (left: ScheduleWindow, right: ScheduleWindow) => {
  if (left.displayId !== right.displayId) {
    return false;
  }
  if (left.kind !== right.kind) {
    return false;
  }
  return hasDateRangeOverlap(left, right) && hasTimeRangeOverlap(left, right);
};

const toScheduleWindow = (schedule: {
  id?: string;
  name: string;
  kind?: ScheduleKind;
  playlistId: string | null;
  contentId?: string | null;
  displayId: string;
  startDate?: string;
  endDate?: string;
  startTime: string;
  endTime: string;
}): ScheduleWindow => ({
  id: schedule.id,
  name: schedule.name,
  kind: schedule.kind ?? "PLAYLIST",
  playlistId: schedule.playlistId,
  contentId: schedule.contentId ?? null,
  displayId: schedule.displayId,
  startDate: schedule.startDate ?? "1970-01-01",
  endDate: schedule.endDate ?? "2099-12-31",
  startTime: schedule.startTime,
  endTime: schedule.endTime,
});

const ensureNoScheduleConflicts = (input: {
  candidate: ScheduleWindow;
  existing: readonly ScheduleWindow[];
  excludeScheduleIds?: ReadonlySet<string>;
}) => {
  const conflicts = input.existing.filter((current) => {
    if (current.id && input.excludeScheduleIds?.has(current.id)) {
      return false;
    }
    return windowsConflict(input.candidate, current);
  });

  if (conflicts.length === 0) {
    return;
  }

  throw new ScheduleConflictError(SCHEDULE_OVERLAP_MESSAGE, {
    requested: input.candidate,
    conflicts: conflicts.map((conflict) => ({
      ...conflict,
      id: conflict.id ?? "unknown",
    })),
  });
};

const getValidatedWindow = (input: {
  startDate?: string;
  endDate?: string;
  startTime: string;
  endTime: string;
}) => {
  if (!isValidTime(input.startTime) || !isValidTime(input.endTime)) {
    throw new ValidationError("Invalid time range");
  }
  const startDate = input.startDate ?? "1970-01-01";
  const endDate = input.endDate ?? "2099-12-31";
  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    throw new ValidationError("Invalid date range");
  }
  return { startDate, endDate };
};

const ensureFlashContentIsSchedulable = (content: {
  type: string;
  kind?: string;
  status: string;
}) => {
  if (content.type !== "FLASH" || content.kind !== "ROOT") {
    throw new ValidationError(
      "Flash schedules require a root FLASH content item",
    );
  }
  if (content.status !== "READY") {
    throw new ValidationError("Only ready flash content can be scheduled");
  }
};

const buildScheduleViewMaps = async (input: {
  schedules: readonly ScheduleRecord[];
  playlistRepository: PlaylistRepository;
  contentRepository: ContentRepository;
  displayRepository: DisplayRepository;
  ownerId?: string;
}) => {
  const playlistIds = Array.from(
    new Set(
      input.schedules
        .map((schedule) => schedule.playlistId)
        .filter((value): value is string => value !== null),
    ),
  );
  const contentIds = Array.from(
    new Set(
      input.schedules
        .map((schedule) => schedule.contentId)
        .filter((value): value is string => value !== null),
    ),
  );
  const displayIds = Array.from(
    new Set(input.schedules.map((schedule) => schedule.displayId)),
  );

  const [playlists, contents, displays] = await Promise.all([
    input.ownerId && input.playlistRepository.findByIdsForOwner
      ? input.playlistRepository.findByIdsForOwner(playlistIds, input.ownerId)
      : input.playlistRepository.findByIds(playlistIds),
    input.ownerId && input.contentRepository.findByIdsForOwner
      ? input.contentRepository.findByIdsForOwner(contentIds, input.ownerId)
      : input.contentRepository.findByIds(contentIds),
    input.displayRepository.findByIds(displayIds),
  ]);

  return {
    playlistMap: new Map(playlists.map((item) => [item.id, item])),
    contentMap: new Map(contents.map((item) => [item.id, item])),
    displayMap: new Map(displays.map((item) => [item.id, item])),
  };
};

const scheduleTargetVisibleToOwner = (
  schedule: ScheduleRecord,
  maps: {
    playlistMap: Map<string, unknown>;
    contentMap: Map<string, unknown>;
  },
) => {
  if (schedule.playlistId) {
    return maps.playlistMap.has(schedule.playlistId);
  }
  if (schedule.contentId) {
    return maps.contentMap.has(schedule.contentId);
  }
  return false;
};

export class ListSchedulesUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      displayRepository: DisplayRepository;
    },
  ) {}

  async execute(input?: {
    ownerId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const schedules = await this.deps.scheduleRepository.list();
    const maps = await buildScheduleViewMaps({
      schedules,
      playlistRepository: this.deps.playlistRepository,
      contentRepository: this.deps.contentRepository,
      displayRepository: this.deps.displayRepository,
      ownerId: input?.ownerId,
    });
    const visibleSchedules = schedules.filter((schedule) =>
      scheduleTargetVisibleToOwner(schedule, maps),
    );
    const views = visibleSchedules.map((schedule) =>
      toScheduleView(
        schedule,
        schedule.playlistId
          ? (maps.playlistMap.get(schedule.playlistId) ?? null)
          : null,
        schedule.contentId
          ? (maps.contentMap.get(schedule.contentId) ?? null)
          : null,
        maps.displayMap.get(schedule.displayId) ?? null,
      ),
    );
    return paginate(views, { page: input?.page, pageSize: input?.pageSize });
  }
}

export class ListScheduleWindowUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      displayRepository: DisplayRepository;
    },
  ) {}

  async execute(input: {
    ownerId?: string;
    from: string;
    to: string;
    displayIds?: string[];
  }) {
    const filtered =
      this.deps.scheduleRepository.listWindow != null
        ? await this.deps.scheduleRepository.listWindow(input)
        : (await this.deps.scheduleRepository.list())
            .filter((schedule) => {
              if (
                input.displayIds &&
                input.displayIds.length > 0 &&
                !input.displayIds.includes(schedule.displayId)
              ) {
                return false;
              }

              return hasDateRangeOverlap(toScheduleWindow(schedule), {
                name: "window",
                kind: schedule.kind ?? "PLAYLIST",
                playlistId: null,
                contentId: null,
                displayId: schedule.displayId,
                startDate: input.from,
                endDate: input.to,
                startTime: "00:00",
                endTime: "23:59",
              });
            })
            .sort((left, right) => {
              const dateDelta = (left.startDate ?? "").localeCompare(
                right.startDate ?? "",
              );
              if (dateDelta !== 0) {
                return dateDelta;
              }
              const timeDelta = left.startTime.localeCompare(right.startTime);
              if (timeDelta !== 0) {
                return timeDelta;
              }
              return left.name.localeCompare(right.name);
            });

    const maps = await buildScheduleViewMaps({
      schedules: filtered,
      playlistRepository: this.deps.playlistRepository,
      contentRepository: this.deps.contentRepository,
      displayRepository: this.deps.displayRepository,
      ownerId: input.ownerId,
    });

    return filtered
      .filter((schedule) => scheduleTargetVisibleToOwner(schedule, maps))
      .map((schedule) =>
        toScheduleView(
          schedule,
          schedule.playlistId
            ? (maps.playlistMap.get(schedule.playlistId) ?? null)
            : null,
          schedule.contentId
            ? (maps.contentMap.get(schedule.contentId) ?? null)
            : null,
          maps.displayMap.get(schedule.displayId) ?? null,
        ),
      );
  }
}

export class CreateScheduleUseCase {
  constructor(
    private readonly deps: ScheduleMutationDeps & {
      displayEventPublisher?: DisplayStreamEventPublisher;
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
    isActive: boolean;
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
          displayWidth: display.screenWidth,
          displayHeight: display.screenHeight,
          scrollPxPerSecond: DEFAULT_SCROLL_PX_PER_SECOND,
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

    const schedule = await this.deps.scheduleRepository.create({
      name: candidate.name,
      kind: candidate.kind,
      playlistId: candidate.playlistId,
      contentId: candidate.contentId,
      displayId: candidate.displayId,
      startDate: candidate.startDate,
      endDate: candidate.endDate,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      priority: DEFAULT_SCHEDULE_PRIORITY,
      isActive: input.isActive,
    });

    if (playlist) {
      await this.deps.playlistRepository.updateStatus(playlist.id, "IN_USE");
    }
    this.deps.displayEventPublisher?.publish({
      type: "schedule_updated",
      displayId: input.displayId,
      reason: "schedule_created",
    });

    return toScheduleView(schedule, playlist, content, display);
  }
}

export class GetScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      displayRepository: DisplayRepository;
    },
  ) {}

  async execute(input: { id: string; ownerId?: string }) {
    const schedule = await this.deps.scheduleRepository.findById(input.id);
    if (!schedule) throw new NotFoundError("Schedule not found");

    const [playlist, content, display] = await Promise.all([
      schedule.playlistId
        ? input.ownerId && this.deps.playlistRepository.findByIdForOwner
          ? this.deps.playlistRepository.findByIdForOwner(
              schedule.playlistId,
              input.ownerId,
            )
          : this.deps.playlistRepository.findById(schedule.playlistId)
        : Promise.resolve(null),
      schedule.contentId
        ? input.ownerId && this.deps.contentRepository.findByIdForOwner
          ? this.deps.contentRepository.findByIdForOwner(
              schedule.contentId,
              input.ownerId,
            )
          : this.deps.contentRepository.findById(schedule.contentId)
        : Promise.resolve(null),
      this.deps.displayRepository.findById(schedule.displayId),
    ]);

    if (
      (schedule.playlistId && !playlist) ||
      (schedule.contentId && !content)
    ) {
      throw new NotFoundError("Schedule not found");
    }

    return toScheduleView(schedule, playlist, content, display);
  }
}

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

export class DeleteScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: { id: string; ownerId?: string }) {
    const existing = await this.deps.scheduleRepository.findById(input.id);
    if (!existing) throw new NotFoundError("Schedule not found");
    await ensureScheduleVisibleToOwner({
      ownerId: input.ownerId,
      schedule: existing,
      playlistRepository: this.deps.playlistRepository,
      contentRepository: this.deps.contentRepository,
    });

    const deleted = await this.deps.scheduleRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Schedule not found");

    if (existing.playlistId) {
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
    this.deps.displayEventPublisher?.publish({
      type: "schedule_updated",
      displayId: existing.displayId,
      reason: "schedule_deleted",
    });
  }
}

export class GetActiveScheduleForDisplayUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { displayId: string; now: Date }) {
    const schedules = await this.deps.scheduleRepository.listByDisplay(
      input.displayId,
    );
    return selectActiveScheduleByKind(
      schedules,
      "PLAYLIST",
      input.now,
      this.deps.scheduleTimeZone ?? DEFAULT_SCHEDULE_TIMEZONE,
    );
  }
}
