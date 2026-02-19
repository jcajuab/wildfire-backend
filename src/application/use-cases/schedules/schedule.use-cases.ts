import { ValidationError } from "#/application/errors/validation";
import { type DeviceRepository } from "#/application/ports/devices";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { paginate } from "#/application/use-cases/shared/pagination";
import {
  isValidDate,
  isValidDaysOfWeek,
  isValidTime,
  selectActiveSchedule,
} from "#/domain/schedules/schedule";
import { NotFoundError } from "./errors";
import { toScheduleView } from "./schedule-view";

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
    daysOfWeek: number[];
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
    if (!isValidDaysOfWeek(input.daysOfWeek)) {
      throw new ValidationError("Invalid days of week");
    }

    const [playlist, device] = await Promise.all([
      this.deps.playlistRepository.findById(input.playlistId),
      this.deps.deviceRepository.findById(input.deviceId),
    ]);
    if (!playlist) throw new NotFoundError("Playlist not found");
    if (!device) throw new NotFoundError("Device not found");

    const schedule = await this.deps.scheduleRepository.create({
      name: input.name,
      playlistId: input.playlistId,
      deviceId: input.deviceId,
      startDate,
      endDate,
      startTime: input.startTime,
      endTime: input.endTime,
      daysOfWeek: input.daysOfWeek,
      priority: input.priority,
      isActive: input.isActive,
    });
    await this.deps.playlistRepository.updateStatus(input.playlistId, "IN_USE");

    return toScheduleView(schedule, playlist, device);
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
    daysOfWeek?: number[];
    priority?: number;
    isActive?: boolean;
  }) {
    if (
      (input.startTime && !isValidTime(input.startTime)) ||
      (input.endTime && !isValidTime(input.endTime))
    ) {
      throw new ValidationError("Invalid time range");
    }
    if (input.daysOfWeek && !isValidDaysOfWeek(input.daysOfWeek)) {
      throw new ValidationError("Invalid days of week");
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

    const [playlistForUpdate, deviceForUpdate] = await Promise.all([
      input.playlistId
        ? this.deps.playlistRepository.findById(input.playlistId)
        : Promise.resolve(undefined),
      input.deviceId
        ? this.deps.deviceRepository.findById(input.deviceId)
        : Promise.resolve(undefined),
    ]);
    if (input.playlistId && !playlistForUpdate) {
      throw new NotFoundError("Playlist not found");
    }
    if (input.deviceId && !deviceForUpdate) {
      throw new NotFoundError("Device not found");
    }

    const schedule = await this.deps.scheduleRepository.update(input.id, {
      name: input.name,
      playlistId: input.playlistId,
      deviceId: input.deviceId,
      startDate: input.startDate,
      endDate: input.endDate,
      startTime: input.startTime,
      endTime: input.endTime,
      daysOfWeek: input.daysOfWeek,
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

    const [playlist, device] = await Promise.all([
      this.deps.playlistRepository.findById(schedule.playlistId),
      this.deps.deviceRepository.findById(schedule.deviceId),
    ]);

    return toScheduleView(schedule, playlist, device);
  }
}

export class DeleteScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
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
