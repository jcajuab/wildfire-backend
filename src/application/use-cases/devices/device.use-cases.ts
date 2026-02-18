import { ValidationError } from "#/application/errors/validation";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type DeviceRepository } from "#/application/ports/devices";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import { paginate } from "#/application/use-cases/shared/pagination";
import { sha256Hex } from "#/domain/content/checksum";
import {
  createDeviceProps,
  type DeviceInput,
  DeviceValidationError,
} from "#/domain/devices/device";
import { selectActiveSchedule } from "#/domain/schedules/schedule";
import { NotFoundError } from "./errors";

const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];

  const workerCount = Math.max(
    1,
    Math.min(Math.trunc(concurrency), items.length),
  );
  const result = new Array<R>(items.length);
  let index = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = index;
        index += 1;
        if (currentIndex >= items.length) {
          return;
        }

        const item = items[currentIndex];
        if (!item) {
          continue;
        }
        result[currentIndex] = await mapper(item, currentIndex);
      }
    }),
  );

  return result;
};

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function withTelemetry(device: {
  id: string;
  identifier: string;
  name: string;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  const lastSeenAt = device.updatedAt;
  const lastSeenMs = Date.parse(lastSeenAt);
  const onlineStatus =
    Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs <= ONLINE_WINDOW_MS
      ? "LIVE"
      : "DOWN";
  return {
    ...device,
    lastSeenAt,
    onlineStatus,
  } as const;
}

export class ListDevicesUseCase {
  constructor(private readonly deps: { deviceRepository: DeviceRepository }) {}

  async execute(input?: { page?: number; pageSize?: number }) {
    const all = await this.deps.deviceRepository.list();
    const withStatus = all.map(withTelemetry);
    return paginate(withStatus, input);
  }
}

export class GetDeviceUseCase {
  constructor(private readonly deps: { deviceRepository: DeviceRepository }) {}

  async execute(input: { id: string }) {
    const device = await this.deps.deviceRepository.findById(input.id);
    if (!device) throw new NotFoundError("Device not found");
    return withTelemetry(device);
  }
}

export class RegisterDeviceUseCase {
  constructor(private readonly deps: { deviceRepository: DeviceRepository }) {}

  async execute(input: DeviceInput) {
    let props: ReturnType<typeof createDeviceProps>;
    try {
      props = createDeviceProps(input);
    } catch (error) {
      if (error instanceof DeviceValidationError) {
        throw new ValidationError(error.message);
      }
      throw error;
    }
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
      return withTelemetry(updated);
    }

    const created = await this.deps.deviceRepository.create({
      name: props.name,
      identifier: props.identifier,
      location: props.location,
    });
    return withTelemetry(created);
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
    await this.deps.deviceRepository.touchSeen?.(input.deviceId, input.now);
    const [device, schedules] = await Promise.all([
      this.deps.deviceRepository.findById(input.deviceId),
      this.deps.scheduleRepository.listByDevice(input.deviceId),
    ]);
    if (!device) throw new NotFoundError("Device not found");
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
    await this.deps.deviceRepository.touchSeen?.(input.deviceId, input.now);
    const [device, schedules] = await Promise.all([
      this.deps.deviceRepository.findById(input.deviceId),
      this.deps.scheduleRepository.listByDevice(input.deviceId),
    ]);
    if (!device) throw new NotFoundError("Device not found");
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

    const manifestItems = await mapWithConcurrency(items, 8, async (item) => {
      const content = contentsById.get(item.contentId);
      if (!content) throw new NotFoundError("Content not found");

      const downloadUrl =
        await this.deps.contentStorage.getPresignedDownloadUrl({
          key: content.fileKey,
          expiresInSeconds: this.deps.downloadUrlExpiresInSeconds,
        });

      return {
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
      };
    });

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
