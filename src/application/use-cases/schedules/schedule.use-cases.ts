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
import { splitPdfDocumentDurationAcrossPages } from "#/application/use-cases/shared/pdf-duration";
import {
  isValidDate,
  isValidTime,
  selectActiveScheduleByKind,
} from "#/domain/schedules/schedule";
import { NotFoundError, ScheduleConflictError } from "./errors";
import { toScheduleView } from "./schedule-view";

const DEFAULT_OVERFLOW_SCROLL_PIXELS_PER_SECOND = 24;
const DEFAULT_SCHEDULE_PRIORITY = 1;
const DAY_SECONDS = 24 * 60 * 60;
const SCHEDULE_OVERLAP_MESSAGE =
  "This schedule overlaps with an existing schedule on the selected display.";

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

const computeRequiredMinDurationSeconds = async (input: {
  playlistRepository: PlaylistRepository;
  contentRepository: ContentRepository;
  playlistId: string;
  displayWidth: number;
  displayHeight: number;
  scrollPxPerSecond: number;
}): Promise<number> => {
  const items = await input.playlistRepository.listItems(input.playlistId);
  if (items.length === 0) return 0;
  const contentIds = Array.from(new Set(items.map((item) => item.contentId)));
  const contents = await input.contentRepository.findByIds(contentIds);
  const contentById = new Map(contents.map((content) => [content.id, content]));
  const parentPdfIds = contents
    .filter((content) => content.kind === "ROOT" && content.type === "PDF")
    .map((content) => content.id);
  const childPagesByParentId = new Map<string, typeof contents>();
  if (
    parentPdfIds.length > 0 &&
    input.contentRepository.findChildrenByParentIds
  ) {
    const childPages = await input.contentRepository.findChildrenByParentIds(
      parentPdfIds,
      {
        includeExcluded: false,
        onlyReady: true,
      },
    );
    for (const childPage of childPages) {
      if (!childPage.parentContentId) {
        continue;
      }
      const current = childPagesByParentId.get(childPage.parentContentId) ?? [];
      childPagesByParentId.set(childPage.parentContentId, [
        ...current,
        childPage,
      ]);
    }
  }

  let baseDuration = 0;
  let overflowExtra = 0;
  for (const item of items) {
    const content = contentById.get(item.contentId);
    if (!content) continue;
    if (content.kind === "ROOT" && content.type === "PDF") {
      const childPages = childPagesByParentId.get(content.id) ?? [];
      const pages = childPages.length > 0 ? childPages : [content];
      const pageDurations = splitPdfDocumentDurationAcrossPages({
        totalDurationSeconds: item.duration,
        pageCount: pages.length,
      });
      baseDuration += pageDurations.reduce(
        (sum, duration) => sum + duration,
        0,
      );
      for (const page of pages) {
        if (
          page.width !== null &&
          page.height !== null &&
          page.width > 0 &&
          page.height > 0
        ) {
          const scaledHeight = (input.displayWidth / page.width) * page.height;
          const overflow = Math.max(0, scaledHeight - input.displayHeight);
          overflowExtra += Math.ceil(overflow / input.scrollPxPerSecond);
        }
      }
      continue;
    }
    baseDuration += item.duration;
    if (
      (content.type === "IMAGE" || content.type === "PDF") &&
      content.width !== null &&
      content.height !== null &&
      content.width > 0 &&
      content.height > 0
    ) {
      const scaledHeight =
        (input.displayWidth / content.width) * content.height;
      const overflow = Math.max(0, scaledHeight - input.displayHeight);
      overflowExtra += Math.ceil(overflow / input.scrollPxPerSecond);
    }
  }
  return baseDuration + overflowExtra;
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
    input.playlistRepository.findByIds(playlistIds),
    input.contentRepository.findByIds(contentIds),
    input.displayRepository.findByIds(displayIds),
  ]);

  return {
    playlistMap: new Map(playlists.map((item) => [item.id, item])),
    contentMap: new Map(contents.map((item) => [item.id, item])),
    displayMap: new Map(displays.map((item) => [item.id, item])),
  };
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

  async execute(input?: { page?: number; pageSize?: number }) {
    const schedules = await this.deps.scheduleRepository.list();
    const maps = await buildScheduleViewMaps({
      schedules,
      playlistRepository: this.deps.playlistRepository,
      contentRepository: this.deps.contentRepository,
      displayRepository: this.deps.displayRepository,
    });
    const views = schedules.map((schedule) =>
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
    return paginate(views, input);
  }
}

export class CreateScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      displayRepository: DisplayRepository;
      contentRepository: ContentRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: {
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
      playlist = await this.deps.playlistRepository.findById(input.playlistId);
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
        await computeRequiredMinDurationSeconds({
          playlistRepository: this.deps.playlistRepository,
          contentRepository: this.deps.contentRepository,
          playlistId: input.playlistId,
          displayWidth: display.screenWidth,
          displayHeight: display.screenHeight,
          scrollPxPerSecond: DEFAULT_OVERFLOW_SCROLL_PIXELS_PER_SECOND,
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
      content = await this.deps.contentRepository.findById(input.contentId);
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

  async execute(input: { id: string }) {
    const schedule = await this.deps.scheduleRepository.findById(input.id);
    if (!schedule) throw new NotFoundError("Schedule not found");

    const [playlist, content, display] = await Promise.all([
      schedule.playlistId
        ? this.deps.playlistRepository.findById(schedule.playlistId)
        : Promise.resolve(null),
      schedule.contentId
        ? this.deps.contentRepository.findById(schedule.contentId)
        : Promise.resolve(null),
      this.deps.displayRepository.findById(schedule.displayId),
    ]);

    return toScheduleView(schedule, playlist, content, display);
  }
}

export class UpdateScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      displayRepository: DisplayRepository;
      contentRepository: ContentRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: {
    id: string;
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
      playlist = await this.deps.playlistRepository.findById(nextPlaylistId);
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
        await computeRequiredMinDurationSeconds({
          playlistRepository: this.deps.playlistRepository,
          contentRepository: this.deps.contentRepository,
          playlistId: nextPlaylistId,
          displayWidth: display.screenWidth,
          displayHeight: display.screenHeight,
          scrollPxPerSecond: DEFAULT_OVERFLOW_SCROLL_PIXELS_PER_SECOND,
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
      content = await this.deps.contentRepository.findById(nextContentId);
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
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: { id: string }) {
    const existing = await this.deps.scheduleRepository.findById(input.id);
    if (!existing) throw new NotFoundError("Schedule not found");

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
      this.deps.scheduleTimeZone ?? "UTC",
    );
  }
}
