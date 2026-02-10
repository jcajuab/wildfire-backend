import { type DeviceRepository } from "#/application/ports/devices";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
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

  async execute() {
    const schedules = await this.deps.scheduleRepository.list();
    const playlistMap = new Map(
      (await this.deps.playlistRepository.list()).map((item) => [
        item.id,
        item,
      ]),
    );
    const deviceMap = new Map(
      (await this.deps.deviceRepository.list()).map((item) => [item.id, item]),
    );

    return schedules.map((schedule) =>
      toScheduleView(
        schedule,
        playlistMap.get(schedule.playlistId) ?? null,
        deviceMap.get(schedule.deviceId) ?? null,
      ),
    );
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
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    priority: number;
    isActive: boolean;
  }) {
    if (!isValidTime(input.startTime) || !isValidTime(input.endTime)) {
      throw new Error("Invalid time range");
    }
    if (!isValidDaysOfWeek(input.daysOfWeek)) {
      throw new Error("Invalid days of week");
    }

    const playlist = await this.deps.playlistRepository.findById(
      input.playlistId,
    );
    if (!playlist) throw new NotFoundError("Playlist not found");

    const device = await this.deps.deviceRepository.findById(input.deviceId);
    if (!device) throw new NotFoundError("Device not found");

    const schedule = await this.deps.scheduleRepository.create({
      name: input.name,
      playlistId: input.playlistId,
      deviceId: input.deviceId,
      startTime: input.startTime,
      endTime: input.endTime,
      daysOfWeek: input.daysOfWeek,
      priority: input.priority,
      isActive: input.isActive,
    });

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

    const playlist = await this.deps.playlistRepository.findById(
      schedule.playlistId,
    );
    const device = await this.deps.deviceRepository.findById(schedule.deviceId);

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
      throw new Error("Invalid time range");
    }
    if (input.daysOfWeek && !isValidDaysOfWeek(input.daysOfWeek)) {
      throw new Error("Invalid days of week");
    }

    if (input.playlistId) {
      const playlist = await this.deps.playlistRepository.findById(
        input.playlistId,
      );
      if (!playlist) throw new NotFoundError("Playlist not found");
    }

    if (input.deviceId) {
      const device = await this.deps.deviceRepository.findById(input.deviceId);
      if (!device) throw new NotFoundError("Device not found");
    }

    const schedule = await this.deps.scheduleRepository.update(input.id, {
      name: input.name,
      playlistId: input.playlistId,
      deviceId: input.deviceId,
      startTime: input.startTime,
      endTime: input.endTime,
      daysOfWeek: input.daysOfWeek,
      priority: input.priority,
      isActive: input.isActive,
    });

    if (!schedule) throw new NotFoundError("Schedule not found");

    const playlist = await this.deps.playlistRepository.findById(
      schedule.playlistId,
    );
    const device = await this.deps.deviceRepository.findById(schedule.deviceId);

    return toScheduleView(schedule, playlist, device);
  }
}

export class DeleteScheduleUseCase {
  constructor(
    private readonly deps: { scheduleRepository: ScheduleRepository },
  ) {}

  async execute(input: { id: string }) {
    const deleted = await this.deps.scheduleRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Schedule not found");
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
