import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DeviceStreamEventPublisher } from "#/application/ports/device-stream-events";
import { type DeviceRepository } from "#/application/ports/devices";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  DEVICE_RUNTIME_SCROLL_PX_PER_SECOND_KEY,
  type SystemSettingRepository,
} from "#/application/ports/settings";
import { paginate } from "#/application/use-cases/shared/pagination";
import {
  isValidDate,
  isValidTime,
  selectActiveSchedule,
} from "#/domain/schedules/schedule";
import { NotFoundError, ScheduleConflictError } from "./errors";
import { toScheduleView } from "./schedule-view";

const DEFAULT_OVERFLOW_SCROLL_PIXELS_PER_SECOND = 24;
const DAY_SECONDS = 24 * 60 * 60;
const SCHEDULE_OVERLAP_MESSAGE =
  "This schedule overlaps with an existing schedule on the selected display.";

type ScheduleWindow = {
  id?: string;
  deviceId: string;
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
  if (left.deviceId !== right.deviceId) {
    return false;
  }

  return hasDateRangeOverlap(left, right) && hasTimeRangeOverlap(left, right);
};

const ensureNoScheduleConflicts = (input: {
  candidates: readonly ScheduleWindow[];
  existing: readonly ScheduleWindow[];
  excludeScheduleIds?: ReadonlySet<string>;
}) => {
  for (const candidate of input.candidates) {
    for (const current of input.existing) {
      if (current.id && input.excludeScheduleIds?.has(current.id)) {
        continue;
      }
      if (windowsConflict(candidate, current)) {
        throw new ScheduleConflictError(SCHEDULE_OVERLAP_MESSAGE);
      }
    }
  }
};

const toScheduleWindow = (schedule: {
  id?: string;
  deviceId: string;
  startDate?: string;
  endDate?: string;
  startTime: string;
  endTime: string;
}): ScheduleWindow => ({
  id: schedule.id,
  deviceId: schedule.deviceId,
  startDate: schedule.startDate ?? "1970-01-01",
  endDate: schedule.endDate ?? "2099-12-31",
  startTime: schedule.startTime,
  endTime: schedule.endTime,
});

const computeRequiredMinDurationSeconds = async (input: {
  playlistRepository: PlaylistRepository;
  contentRepository: ContentRepository;
  playlistId: string;
  deviceWidth: number;
  deviceHeight: number;
  scrollPxPerSecond: number;
}): Promise<number> => {
  const items = await input.playlistRepository.listItems(input.playlistId);
  if (items.length === 0) return 0;
  const contentIds = Array.from(new Set(items.map((item) => item.contentId)));
  const contents = await input.contentRepository.findByIds(contentIds);
  const contentById = new Map(contents.map((content) => [content.id, content]));

  let baseDuration = 0;
  let overflowExtra = 0;
  for (const item of items) {
    baseDuration += item.duration;
    const content = contentById.get(item.contentId);
    if (!content) continue;
    if (
      (content.type === "IMAGE" || content.type === "PDF") &&
      content.width !== null &&
      content.height !== null &&
      content.width > 0 &&
      content.height > 0
    ) {
      const scaledHeight = (input.deviceWidth / content.width) * content.height;
      const overflow = Math.max(0, scaledHeight - input.deviceHeight);
      overflowExtra += Math.ceil(overflow / input.scrollPxPerSecond);
    }
  }
  return baseDuration + overflowExtra;
};

export class ListSchedulesUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      deviceRepository: DeviceRepository;
    },
  ) {}

  async execute(input?: { page?: number; pageSize?: number }) {
    const schedules = await this.deps.scheduleRepository.list();
    const playlistIds = [
      ...new Set(schedules.map((schedule) => schedule.playlistId)),
    ];
    const deviceIds = [
      ...new Set(schedules.map((schedule) => schedule.deviceId)),
    ];
    const [playlists, devices] = await Promise.all([
      this.deps.playlistRepository.findByIds(playlistIds),
      this.deps.deviceRepository.findByIds(deviceIds),
    ]);
    const playlistMap = new Map(playlists.map((item) => [item.id, item]));
    const deviceMap = new Map(devices.map((item) => [item.id, item]));

    const views = schedules.map((schedule) =>
      toScheduleView(
        schedule,
        playlistMap.get(schedule.playlistId) ?? null,
        deviceMap.get(schedule.deviceId) ?? null,
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
      deviceRepository: DeviceRepository;
      contentRepository: ContentRepository;
      systemSettingRepository?: SystemSettingRepository;
      deviceEventPublisher?: DeviceStreamEventPublisher;
    },
  ) {}

  async execute(input: {
    name: string;
    playlistId: string;
    deviceId: string;
    startDate?: string;
    endDate?: string;
    startTime: string;
    endTime: string;
    daysOfWeek?: number[];
    priority: number;
    isActive: boolean;
  }) {
    if (!isValidTime(input.startTime) || !isValidTime(input.endTime)) {
      throw new ValidationError("Invalid time range");
    }
    const startDate = input.startDate ?? "1970-01-01";
    const endDate = input.endDate ?? "2099-12-31";
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      throw new ValidationError("Invalid date range");
    }
    if (startDate > endDate) {
      throw new ValidationError("Invalid date range");
    }

    const [playlist, device] = await Promise.all([
      this.deps.playlistRepository.findById(input.playlistId),
      this.deps.deviceRepository.findById(input.deviceId),
    ]);
    if (!playlist) throw new NotFoundError("Playlist not found");
    if (!device) throw new NotFoundError("Device not found");
    if (
      typeof device.screenWidth !== "number" ||
      typeof device.screenHeight !== "number"
    ) {
      throw new ValidationError(
        "Device resolution is required before scheduling",
      );
    }
    const deviceWidth = device.screenWidth;
    const deviceHeight = device.screenHeight;
    const scrollPxPerSecond = await this.getScrollPxPerSecond();
    const requiredMinDurationSeconds = await computeRequiredMinDurationSeconds({
      playlistRepository: this.deps.playlistRepository,
      contentRepository: this.deps.contentRepository,
      playlistId: input.playlistId,
      deviceWidth,
      deviceHeight,
      scrollPxPerSecond,
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

    const existingForDevice = await this.deps.scheduleRepository.listByDevice(
      input.deviceId,
    );
    ensureNoScheduleConflicts({
      candidates: [
        toScheduleWindow({
          deviceId: input.deviceId,
          startDate,
          endDate,
          startTime: input.startTime,
          endTime: input.endTime,
        }),
      ],
      existing: existingForDevice.map(toScheduleWindow),
    });

    const schedule = await this.deps.scheduleRepository.create({
      name: input.name,
      playlistId: input.playlistId,
      deviceId: input.deviceId,
      startDate,
      endDate,
      startTime: input.startTime,
      endTime: input.endTime,
      priority: input.priority,
      isActive: input.isActive,
    });
    await this.deps.playlistRepository.updateStatus(input.playlistId, "IN_USE");
    this.deps.deviceEventPublisher?.publish({
      type: "schedule_updated",
      deviceId: input.deviceId,
      reason: "schedule_created",
    });

    return [toScheduleView(schedule, playlist, device)];
  }

  private async getScrollPxPerSecond(): Promise<number> {
    const setting = await this.deps.systemSettingRepository?.findByKey(
      DEVICE_RUNTIME_SCROLL_PX_PER_SECOND_KEY,
    );
    const parsed = setting ? Number.parseInt(setting.value, 10) : NaN;
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : DEFAULT_OVERFLOW_SCROLL_PIXELS_PER_SECOND;
  }
}

export class GetScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      deviceRepository: DeviceRepository;
    },
  ) {}

  async execute(input: { id: string }) {
    const schedule = await this.deps.scheduleRepository.findById(input.id);
    if (!schedule) throw new NotFoundError("Schedule not found");

    const [playlist, device] = await Promise.all([
      this.deps.playlistRepository.findById(schedule.playlistId),
      this.deps.deviceRepository.findById(schedule.deviceId),
    ]);

    return toScheduleView(schedule, playlist, device);
  }
}

export class UpdateScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      deviceRepository: DeviceRepository;
      contentRepository: ContentRepository;
      systemSettingRepository?: SystemSettingRepository;
      deviceEventPublisher?: DeviceStreamEventPublisher;
    },
  ) {}

  async execute(input: {
    id: string;
    name?: string;
    playlistId?: string;
    deviceId?: string;
    startDate?: string;
    endDate?: string;
    startTime?: string;
    endTime?: string;
    dayOfWeek?: number;
    priority?: number;
    isActive?: boolean;
  }) {
    if (
      (input.startTime && !isValidTime(input.startTime)) ||
      (input.endTime && !isValidTime(input.endTime))
    ) {
      throw new ValidationError("Invalid time range");
    }
    if (
      (input.startDate && !isValidDate(input.startDate)) ||
      (input.endDate && !isValidDate(input.endDate))
    ) {
      throw new ValidationError("Invalid date range");
    }

    const existing = await this.deps.scheduleRepository.findById(input.id);
    if (!existing) throw new NotFoundError("Schedule not found");

    const nextStartDate = input.startDate ?? existing.startDate ?? "";
    const nextEndDate = input.endDate ?? existing.endDate ?? "";
    if (
      nextStartDate.length > 0 &&
      nextEndDate.length > 0 &&
      nextStartDate > nextEndDate
    ) {
      throw new ValidationError("Invalid date range");
    }

    const [
      playlistForUpdate,
      deviceForUpdate,
      existingDevice,
      existingPlaylist,
    ] = await Promise.all([
      input.playlistId
        ? this.deps.playlistRepository.findById(input.playlistId)
        : Promise.resolve(undefined),
      input.deviceId
        ? this.deps.deviceRepository.findById(input.deviceId)
        : Promise.resolve(undefined),
      this.deps.deviceRepository.findById(existing.deviceId),
      this.deps.playlistRepository.findById(existing.playlistId),
    ]);
    if (input.playlistId && !playlistForUpdate) {
      throw new NotFoundError("Playlist not found");
    }
    if (input.deviceId && !deviceForUpdate) {
      throw new NotFoundError("Device not found");
    }

    const resolvedDevice = input.deviceId ? deviceForUpdate : existingDevice;
    if (!resolvedDevice) {
      throw new NotFoundError("Device not found");
    }
    if (
      typeof resolvedDevice.screenWidth !== "number" ||
      typeof resolvedDevice.screenHeight !== "number"
    ) {
      throw new ValidationError(
        "Device resolution is required before scheduling",
      );
    }
    const resolvedPlaylist = input.playlistId
      ? playlistForUpdate
      : existingPlaylist;
    if (!resolvedPlaylist) {
      throw new NotFoundError("Playlist not found");
    }

    const nextStartTime = input.startTime ?? existing.startTime;
    const nextEndTime = input.endTime ?? existing.endTime;
    const deviceWidth = resolvedDevice.screenWidth;
    const deviceHeight = resolvedDevice.screenHeight;
    const scrollPxPerSecond = await this.getScrollPxPerSecond();
    const requiredMinDurationSeconds = await computeRequiredMinDurationSeconds({
      playlistRepository: this.deps.playlistRepository,
      contentRepository: this.deps.contentRepository,
      playlistId: resolvedPlaylist.id,
      deviceWidth,
      deviceHeight,
      scrollPxPerSecond,
    });
    const windowDurationSeconds = computeWindowDurationSeconds(
      nextStartTime,
      nextEndTime,
    );
    if (windowDurationSeconds < requiredMinDurationSeconds) {
      throw new ValidationError(
        `Schedule window is too short. Required minimum is ${requiredMinDurationSeconds} seconds.`,
      );
    }

    const targetDeviceId = input.deviceId ?? existing.deviceId;
    const existingForDevice =
      await this.deps.scheduleRepository.listByDevice(targetDeviceId);
    ensureNoScheduleConflicts({
      candidates: [
        toScheduleWindow({
          id: existing.id,
          deviceId: targetDeviceId,
          startDate: nextStartDate,
          endDate: nextEndDate,
          startTime: nextStartTime,
          endTime: nextEndTime,
        }),
      ],
      existing: existingForDevice.map(toScheduleWindow),
      excludeScheduleIds: new Set([existing.id]),
    });

    const schedule = await this.deps.scheduleRepository.update(input.id, {
      name: input.name,
      playlistId: input.playlistId,
      deviceId: input.deviceId,
      startDate: input.startDate,
      endDate: input.endDate,
      startTime: input.startTime,
      endTime: input.endTime,
      priority: input.priority,
      isActive: input.isActive,
    });

    if (!schedule) throw new NotFoundError("Schedule not found");

    const previousPlaylistId = existing.playlistId;
    if (previousPlaylistId !== schedule.playlistId) {
      const remaining =
        await this.deps.scheduleRepository.countByPlaylistId(
          previousPlaylistId,
        );
      if (remaining === 0) {
        await this.deps.playlistRepository.updateStatus(
          previousPlaylistId,
          "DRAFT",
        );
      }
    }
    await this.deps.playlistRepository.updateStatus(
      schedule.playlistId,
      "IN_USE",
    );
    this.deps.deviceEventPublisher?.publish({
      type: "schedule_updated",
      deviceId: schedule.deviceId,
      reason: "schedule_updated",
    });

    const [playlist, device] = await Promise.all([
      this.deps.playlistRepository.findById(schedule.playlistId),
      this.deps.deviceRepository.findById(schedule.deviceId),
    ]);

    return toScheduleView(schedule, playlist, device);
  }

  private async getScrollPxPerSecond(): Promise<number> {
    const setting = await this.deps.systemSettingRepository?.findByKey(
      DEVICE_RUNTIME_SCROLL_PX_PER_SECOND_KEY,
    );
    const parsed = setting ? Number.parseInt(setting.value, 10) : NaN;
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : DEFAULT_OVERFLOW_SCROLL_PIXELS_PER_SECOND;
  }
}

export class DeleteScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      deviceEventPublisher?: DeviceStreamEventPublisher;
    },
  ) {}

  async execute(input: { id: string }) {
    const existing = await this.deps.scheduleRepository.findById(input.id);
    if (!existing) throw new NotFoundError("Schedule not found");

    const deleted = await this.deps.scheduleRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Schedule not found");

    const remaining = await this.deps.scheduleRepository.countByPlaylistId(
      existing.playlistId,
    );
    if (remaining === 0) {
      await this.deps.playlistRepository.updateStatus(
        existing.playlistId,
        "DRAFT",
      );
    }
    this.deps.deviceEventPublisher?.publish({
      type: "schedule_updated",
      deviceId: existing.deviceId,
      reason: "schedule_deleted",
    });
  }
}

export class GetActiveScheduleForDeviceUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { deviceId: string; now: Date }) {
    const schedules = await this.deps.scheduleRepository.listByDevice(
      input.deviceId,
    );
    return selectActiveSchedule(
      schedules,
      input.now,
      this.deps.scheduleTimeZone ?? "UTC",
    );
  }
}
