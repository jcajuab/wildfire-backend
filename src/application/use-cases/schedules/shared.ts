import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayRepository } from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import {
  type ScheduleKind,
  type ScheduleRecord,
  type ScheduleRepository,
} from "#/application/ports/schedules";
import { isValidDate, isValidTime } from "#/domain/schedules/schedule";
import { NotFoundError, ScheduleConflictError } from "./errors";

export const DAY_SECONDS = 24 * 60 * 60;
export const DEFAULT_SCHEDULE_TIMEZONE = "UTC";
export const SCHEDULE_OVERLAP_MESSAGE =
  "This schedule overlaps with an existing schedule on the selected display.";

export type ScheduleMutationDeps = {
  scheduleRepository: ScheduleRepository;
  playlistRepository: PlaylistRepository;
  displayRepository: DisplayRepository;
  contentRepository: ContentRepository;
  timezone?: string;
};

export type ScheduleWindow = {
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

export const findPlaylistForOwner = async (
  playlistRepository: PlaylistRepository,
  playlistId: string,
  ownerId?: string,
) => {
  if (ownerId && playlistRepository.findByIdForOwner) {
    return playlistRepository.findByIdForOwner(playlistId, ownerId);
  }
  return playlistRepository.findById(playlistId);
};

export const findContentForOwner = async (
  contentRepository: ContentRepository,
  contentId: string,
  ownerId?: string,
) => {
  if (ownerId && contentRepository.findByIdForOwner) {
    return contentRepository.findByIdForOwner(contentId, ownerId);
  }
  return contentRepository.findById(contentId);
};

export const ensureScheduleVisibleToOwner = async (input: {
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

export const parseTimeToSeconds = (value: string): number => {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number.parseInt(hourRaw ?? "", 10);
  const minute = Number.parseInt(minuteRaw ?? "", 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new ValidationError("Invalid schedule time format");
  }
  return hour * 3600 + minute * 60;
};

export const computeWindowDurationSeconds = (
  startTime: string,
  endTime: string,
) => {
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

export const toDailyTimeSegments = (
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

export const hasDateRangeOverlap = (
  left: ScheduleWindow,
  right: ScheduleWindow,
) => left.startDate <= right.endDate && right.startDate <= left.endDate;

export const hasTimeRangeOverlap = (
  left: ScheduleWindow,
  right: ScheduleWindow,
) => {
  const leftSegments = toDailyTimeSegments(left.startTime, left.endTime);
  const rightSegments = toDailyTimeSegments(right.startTime, right.endTime);
  return leftSegments.some(([leftStart, leftEnd]) =>
    rightSegments.some(
      ([rightStart, rightEnd]) => leftStart < rightEnd && rightStart < leftEnd,
    ),
  );
};

export const windowsConflict = (
  left: ScheduleWindow,
  right: ScheduleWindow,
) => {
  if (left.displayId !== right.displayId) {
    return false;
  }
  if (left.kind !== right.kind) {
    return false;
  }
  // PLAYLIST schedules can overlap - they merge at runtime
  if (left.kind === "PLAYLIST") {
    return false;
  }
  // FLASH schedules still cannot overlap
  return hasDateRangeOverlap(left, right) && hasTimeRangeOverlap(left, right);
};

export const toScheduleWindow = (schedule: {
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

export const ensureNoScheduleConflicts = (input: {
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

export const getValidatedWindow = (input: {
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

export const ensureFlashContentIsSchedulable = (content: {
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

export const buildScheduleViewMaps = async (input: {
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

export const scheduleTargetVisibleToOwner = (
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
