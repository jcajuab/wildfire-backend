import { ValidationError } from "#/application/errors/validation";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import {
  type DeviceRecord,
  type DeviceRepository,
} from "#/application/ports/devices";
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

function withTelemetry(device: DeviceRecord) {
  const lastSeenAt = device.updatedAt;
  const lastSeenMs = Date.parse(lastSeenAt);
  const onlineStatus =
    Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs <= ONLINE_WINDOW_MS
      ? "LIVE"
      : "DOWN";
  return {
    ...device,
    ipAddress: device.ipAddress ?? null,
    macAddress: device.macAddress ?? null,
    screenWidth: device.screenWidth ?? null,
    screenHeight: device.screenHeight ?? null,
    outputType: device.outputType ?? null,
    orientation: device.orientation ?? null,
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
        ipAddress: props.ipAddress,
        macAddress: props.macAddress,
        screenWidth: props.screenWidth,
        screenHeight: props.screenHeight,
        outputType: props.outputType,
        orientation: props.orientation,
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
    if (
      props.ipAddress !== null ||
      props.macAddress !== null ||
      props.screenWidth !== null ||
      props.screenHeight !== null ||
      props.outputType !== null ||
      props.orientation !== null
    ) {
      const enriched = await this.deps.deviceRepository.update(created.id, {
        ipAddress: props.ipAddress,
        macAddress: props.macAddress,
        screenWidth: props.screenWidth,
        screenHeight: props.screenHeight,
        outputType: props.outputType,
        orientation: props.orientation,
      });
      return withTelemetry(enriched ?? created);
    }
    return withTelemetry(created);
  }
}

export class UpdateDeviceUseCase {
  constructor(private readonly deps: { deviceRepository: DeviceRepository }) {}

  async execute(input: {
    id: string;
    name?: string;
    location?: string | null;
    ipAddress?: string | null;
    macAddress?: string | null;
    screenWidth?: number | null;
    screenHeight?: number | null;
    outputType?: string | null;
    orientation?: "LANDSCAPE" | "PORTRAIT" | null;
  }) {
    const normalizedName =
      input.name === undefined ? undefined : input.name.trim();
    if (normalizedName !== undefined && normalizedName.length === 0) {
      throw new ValidationError("Name is required");
    }

    const normalizeOptionalText = (
      value: string | null | undefined,
      fieldName: string,
    ): string | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new ValidationError(`${fieldName} cannot be empty`);
      }
      return trimmed;
    };

    const ipAddress = normalizeOptionalText(input.ipAddress, "ipAddress");
    const macAddress = normalizeOptionalText(input.macAddress, "macAddress");
    const normalizedOutputType = normalizeOptionalText(
      input.outputType,
      "outputType",
    );

    const normalizeDimension = (
      value: number | null | undefined,
      fieldName: string,
    ): number | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (!Number.isInteger(value) || value <= 0) {
        throw new ValidationError(`${fieldName} must be a positive integer`);
      }
      return value;
    };

    const screenWidth = normalizeDimension(input.screenWidth, "screenWidth");
    const screenHeight = normalizeDimension(input.screenHeight, "screenHeight");
    const updated = await this.deps.deviceRepository.update(input.id, {
      name: normalizedName,
      location: input.location,
      ipAddress,
      macAddress,
      screenWidth,
      screenHeight,
      outputType: normalizedOutputType,
      orientation: input.orientation,
    });
    if (!updated) throw new NotFoundError("Device not found");
    return withTelemetry(updated);
  }
}

export class RequestDeviceRefreshUseCase {
  constructor(private readonly deps: { deviceRepository: DeviceRepository }) {}

  async execute(input: { id: string }): Promise<void> {
    const bumped = await this.deps.deviceRepository.bumpRefreshNonce(input.id);
    if (!bumped) {
      throw new NotFoundError("Device not found");
    }
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
      refreshNonce: device.refreshNonce ?? 0,
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
