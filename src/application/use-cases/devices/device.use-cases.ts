import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type DeviceRepository } from "#/application/ports/devices";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { sha256Hex } from "#/domain/content/checksum";
import { createDeviceProps, type DeviceInput } from "#/domain/devices/device";
import { selectActiveSchedule } from "#/domain/schedules/schedule";
import { NotFoundError } from "./errors";

export class ListDevicesUseCase {
  constructor(private readonly deps: { deviceRepository: DeviceRepository }) {}

  execute() {
    return this.deps.deviceRepository.list();
  }
}

export class GetDeviceUseCase {
  constructor(private readonly deps: { deviceRepository: DeviceRepository }) {}

  async execute(input: { id: string }) {
    const device = await this.deps.deviceRepository.findById(input.id);
    if (!device) throw new NotFoundError("Device not found");
    return device;
  }
}

export class RegisterDeviceUseCase {
  constructor(private readonly deps: { deviceRepository: DeviceRepository }) {}

  async execute(input: DeviceInput) {
    const props = createDeviceProps(input);
    const existing = await this.deps.deviceRepository.findByIdentifier(
      props.identifier,
    );

    if (existing) {
      const updated = await this.deps.deviceRepository.update(existing.id, {
        name: props.name,
        location: props.location,
      });
      if (!updated) {
        throw new NotFoundError("Device not found");
      }
      return updated;
    }

    return this.deps.deviceRepository.create({
      name: props.name,
      identifier: props.identifier,
      location: props.location,
    });
  }
}

export class GetDeviceActiveScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      deviceRepository: DeviceRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { deviceId: string; now: Date }) {
    const device = await this.deps.deviceRepository.findById(input.deviceId);
    if (!device) throw new NotFoundError("Device not found");

    const schedules = await this.deps.scheduleRepository.listByDevice(
      input.deviceId,
    );
    const active = selectActiveSchedule(
      schedules,
      input.now,
      this.deps.scheduleTimeZone ?? "UTC",
    );

    if (!active) return null;

    return {
      id: active.id,
      name: active.name,
      playlistId: active.playlistId,
      deviceId: active.deviceId,
      startTime: active.startTime,
      endTime: active.endTime,
      daysOfWeek: active.daysOfWeek,
      priority: active.priority,
      isActive: active.isActive,
      createdAt: active.createdAt,
      updatedAt: active.updatedAt,
      playlist: {
        id: active.playlistId,
        name:
          (await this.deps.playlistRepository.findById(active.playlistId))
            ?.name ?? null,
      },
      device: { id: device.id, name: device.name },
    };
  }
}

export class GetDeviceManifestUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      contentStorage: ContentStorage;
      deviceRepository: DeviceRepository;
      downloadUrlExpiresInSeconds: number;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { deviceId: string; now: Date }) {
    const device = await this.deps.deviceRepository.findById(input.deviceId);
    if (!device) throw new NotFoundError("Device not found");

    const schedules = await this.deps.scheduleRepository.listByDevice(
      input.deviceId,
    );
    const active = selectActiveSchedule(
      schedules,
      input.now,
      this.deps.scheduleTimeZone ?? "UTC",
    );

    if (!active) {
      return {
        playlistId: null,
        playlistVersion: "",
        generatedAt: input.now.toISOString(),
        items: [],
      };
    }

    const playlist = await this.deps.playlistRepository.findById(
      active.playlistId,
    );
    if (!playlist) throw new NotFoundError("Playlist not found");

    const items = await this.deps.playlistRepository.listItems(playlist.id);
    const contentIds = Array.from(new Set(items.map((item) => item.contentId)));
    const contents = await this.deps.contentRepository.findByIds(contentIds);
    const contentsById = new Map(
      contents.map((content) => [content.id, content]),
    );

    const manifestItems = [] as Array<{
      id: string;
      sequence: number;
      duration: number;
      content: {
        id: string;
        type: "IMAGE" | "VIDEO" | "PDF";
        checksum: string;
        downloadUrl: string;
        mimeType: string;
        width: number | null;
        height: number | null;
        duration: number | null;
      };
    }>;

    for (const item of items) {
      const content = contentsById.get(item.contentId);
      if (!content) throw new NotFoundError("Content not found");

      const downloadUrl =
        await this.deps.contentStorage.getPresignedDownloadUrl({
          key: content.fileKey,
          expiresInSeconds: this.deps.downloadUrlExpiresInSeconds,
        });

      manifestItems.push({
        id: item.id,
        sequence: item.sequence,
        duration: item.duration,
        content: {
          id: content.id,
          type: content.type,
          checksum: content.checksum,
          downloadUrl,
          mimeType: content.mimeType,
          width: content.width,
          height: content.height,
          duration: content.duration,
        },
      });
    }

    const versionPayload = JSON.stringify({
      playlistId: playlist.id,
      items: manifestItems.map((item) => ({
        id: item.id,
        sequence: item.sequence,
        duration: item.duration,
        contentId: item.content.id,
        checksum: item.content.checksum,
      })),
    });
    const playlistVersion = await sha256Hex(
      new TextEncoder().encode(versionPayload).buffer,
    );

    return {
      playlistId: playlist.id,
      playlistVersion,
      generatedAt: input.now.toISOString(),
      items: manifestItems,
    };
  }
}
