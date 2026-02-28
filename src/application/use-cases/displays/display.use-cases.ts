import { createHash, randomInt } from "node:crypto";
import { ValidationError } from "#/application/errors/validation";
import {
  type ContentRepository,
  type ContentStorage,
} from "#/application/ports/content";
import { type DisplayPairingCodeRepository } from "#/application/ports/display-pairing";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import {
  type DisplayRecord,
  type DisplayRepository,
} from "#/application/ports/displays";
import { type PlaylistRepository } from "#/application/ports/playlists";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  DISPLAY_RUNTIME_SCROLL_PX_PER_SECOND_KEY,
  type SystemSettingRepository,
} from "#/application/ports/settings";
import { paginate } from "#/application/use-cases/shared/pagination";
import { sha256Hex } from "#/domain/content/checksum";
import {
  createDisplayProps,
  type DisplayInput,
  DisplayValidationError,
} from "#/domain/displays/display";
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
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const PAIRING_CODE_DUPLICATE_INDEX = "pairing_codes_code_hash_unique";
const DEFAULT_RUNTIME_SCROLL_PX_PER_SECOND = 24;

const hashPairingCode = (code: string): string =>
  createHash("sha256").update(code).digest("hex");

const isDuplicatePairingCodeError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const dbError = error as {
    code?: string;
    message?: string;
    sqlMessage?: string;
  };
  const details = [dbError.message, dbError.sqlMessage]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return (
    dbError.code === "ER_DUP_ENTRY" &&
    details.includes(PAIRING_CODE_DUPLICATE_INDEX)
  );
};

const isRecentlySeen = (lastSeenAt: string | null, now: Date): boolean => {
  const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
  return (
    Number.isFinite(lastSeenMs) &&
    now.getTime() - lastSeenMs <= ONLINE_WINDOW_MS
  );
};

function withTelemetry(
  display: DisplayRecord,
  input: { now: Date; hasActiveSchedule: boolean },
) {
  const lastSeenAt = display.lastSeenAt ?? null;
  const connected = isRecentlySeen(lastSeenAt, input.now);
  const onlineStatus = !connected
    ? "DOWN"
    : input.hasActiveSchedule
      ? "LIVE"
      : "READY";
  return {
    ...display,
    ipAddress: display.ipAddress ?? null,
    macAddress: display.macAddress ?? null,
    screenWidth: display.screenWidth ?? null,
    screenHeight: display.screenHeight ?? null,
    outputType: display.outputType ?? null,
    orientation: display.orientation ?? null,
    lastSeenAt,
    onlineStatus,
  } as const;
}

export class ListDisplaysUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      scheduleRepository: ScheduleRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input?: { page?: number; pageSize?: number }) {
    const now = new Date();
    const [all, schedules] = await Promise.all([
      this.deps.displayRepository.list(),
      this.deps.scheduleRepository.list(),
    ]);
    const schedulesByDisplayId = new Map<string, typeof schedules>();
    for (const schedule of schedules) {
      const grouped = schedulesByDisplayId.get(schedule.displayId);
      if (grouped) {
        grouped.push(schedule);
        continue;
      }
      schedulesByDisplayId.set(schedule.displayId, [schedule]);
    }

    const withStatus = all.map((display) => {
      const activeSchedule = selectActiveSchedule(
        schedulesByDisplayId.get(display.id) ?? [],
        now,
        this.deps.scheduleTimeZone ?? "UTC",
      );
      return withTelemetry(display, {
        now,
        hasActiveSchedule: activeSchedule !== null,
      });
    });
    return paginate(withStatus, input);
  }
}

export class GetDisplayUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      scheduleRepository: ScheduleRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { id: string }) {
    const now = new Date();
    const display = await this.deps.displayRepository.findById(input.id);
    if (!display) throw new NotFoundError("Display not found");
    const schedules = await this.deps.scheduleRepository.listByDisplay(
      input.id,
    );
    const activeSchedule = selectActiveSchedule(
      schedules,
      now,
      this.deps.scheduleTimeZone ?? "UTC",
    );
    return withTelemetry(display, {
      now,
      hasActiveSchedule: activeSchedule !== null,
    });
  }
}

export class RegisterDisplayUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayPairingCodeRepository: DisplayPairingCodeRepository;
    },
  ) {}

  async execute(input: DisplayInput & { pairingCode: string }) {
    const now = new Date();
    const pairingCode = input.pairingCode.trim();
    if (!/^\d{6}$/.test(pairingCode)) {
      throw new ValidationError("Pairing code must be a 6-digit number");
    }
    const consumed =
      await this.deps.displayPairingCodeRepository.consumeValidCode({
        codeHash: hashPairingCode(pairingCode),
        now: new Date(),
      });
    if (!consumed) {
      throw new ValidationError(
        "Pairing code is invalid, expired, or already used",
      );
    }

    let props: ReturnType<typeof createDisplayProps>;
    try {
      props = createDisplayProps({
        name: input.name,
        identifier: input.identifier,
        displayFingerprint: input.displayFingerprint,
        location: input.location,
        ipAddress: input.ipAddress,
        macAddress: input.macAddress,
        screenWidth: input.screenWidth,
        screenHeight: input.screenHeight,
        outputType: input.outputType,
        orientation: input.orientation,
      });
    } catch (error) {
      if (error instanceof DisplayValidationError) {
        throw new ValidationError(error.message);
      }
      throw error;
    }
    if (props.screenWidth === null || props.screenHeight === null) {
      throw new ValidationError("Display resolution is required");
    }

    const existing = await this.deps.displayRepository.findByIdentifier(
      props.identifier,
    );
    const existingByFingerprint = props.displayFingerprint
      ? await this.deps.displayRepository.findByFingerprint(
          props.displayFingerprint,
        )
      : null;

    if (
      existing &&
      existingByFingerprint &&
      existing.id !== existingByFingerprint.id
    ) {
      throw new ValidationError(
        "Display identifier and fingerprint belong to different records",
      );
    }

    const target = existing ?? existingByFingerprint;

    if (target) {
      const updated = await this.deps.displayRepository.update(target.id, {
        name: props.name,
        identifier: props.identifier,
        displayFingerprint: props.displayFingerprint,
        location: props.location,
        ipAddress: props.ipAddress,
        macAddress: props.macAddress,
        screenWidth: props.screenWidth,
        screenHeight: props.screenHeight,
        outputType: props.outputType,
        orientation: props.orientation,
      });
      if (!updated) {
        throw new NotFoundError("Display not found");
      }
      await this.deps.displayRepository.touchSeen?.(updated.id, now);
      return withTelemetry(
        { ...updated, lastSeenAt: now.toISOString() },
        { now, hasActiveSchedule: false },
      );
    }

    const created = await this.deps.displayRepository.create({
      name: props.name,
      identifier: props.identifier,
      displayFingerprint: props.displayFingerprint,
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
      const enriched = await this.deps.displayRepository.update(created.id, {
        displayFingerprint: props.displayFingerprint,
        ipAddress: props.ipAddress,
        macAddress: props.macAddress,
        screenWidth: props.screenWidth,
        screenHeight: props.screenHeight,
        outputType: props.outputType,
        orientation: props.orientation,
      });
      const connectedDisplay = enriched ?? created;
      await this.deps.displayRepository.touchSeen?.(connectedDisplay.id, now);
      return withTelemetry(
        { ...connectedDisplay, lastSeenAt: now.toISOString() },
        { now, hasActiveSchedule: false },
      );
    }
    await this.deps.displayRepository.touchSeen?.(created.id, now);
    return withTelemetry(
      { ...created, lastSeenAt: now.toISOString() },
      { now, hasActiveSchedule: false },
    );
  }
}

export class IssueDisplayPairingCodeUseCase {
  constructor(
    private readonly deps: {
      displayPairingCodeRepository: DisplayPairingCodeRepository;
    },
  ) {}

  async execute(input: { createdById: string }) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
      try {
        await this.deps.displayPairingCodeRepository.create({
          codeHash: hashPairingCode(code),
          expiresAt,
          createdById: input.createdById,
        });
        return {
          code,
          expiresAt: expiresAt.toISOString(),
        };
      } catch (error) {
        if (!isDuplicatePairingCodeError(error)) {
          throw error;
        }
      }
    }
    throw new Error("Failed to generate a unique pairing code");
  }
}

export class UpdateDisplayUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      scheduleRepository: ScheduleRepository;
      scheduleTimeZone?: string;
    },
  ) {}

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
    const updated = await this.deps.displayRepository.update(input.id, {
      name: normalizedName,
      location: input.location,
      ipAddress,
      macAddress,
      screenWidth,
      screenHeight,
      outputType: normalizedOutputType,
      orientation: input.orientation,
    });
    if (!updated) throw new NotFoundError("Display not found");
    const now = new Date();
    const schedules = await this.deps.scheduleRepository.listByDisplay(
      input.id,
    );
    const activeSchedule = selectActiveSchedule(
      schedules,
      now,
      this.deps.scheduleTimeZone ?? "UTC",
    );
    return withTelemetry(updated, {
      now,
      hasActiveSchedule: activeSchedule !== null,
    });
  }
}

export class RequestDisplayRefreshUseCase {
  constructor(
    private readonly deps: {
      displayRepository: DisplayRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: { id: string }): Promise<void> {
    const bumped = await this.deps.displayRepository.bumpRefreshNonce(input.id);
    if (!bumped) {
      throw new NotFoundError("Display not found");
    }
    this.deps.displayEventPublisher?.publish({
      type: "display_refresh_requested",
      displayId: input.id,
      reason: "refresh_nonce_bumped",
    });
  }
}

export class GetDisplayActiveScheduleUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      displayRepository: DisplayRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { displayId: string; now: Date }) {
    await this.deps.displayRepository.touchSeen?.(input.displayId, input.now);
    const [display, schedules] = await Promise.all([
      this.deps.displayRepository.findById(input.displayId),
      this.deps.scheduleRepository.listByDisplay(input.displayId),
    ]);
    if (!display) throw new NotFoundError("Display not found");
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
      displayId: active.displayId,
      startDate: active.startDate,
      endDate: active.endDate,
      startTime: active.startTime,
      endTime: active.endTime,
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
      display: { id: display.id, name: display.name },
    };
  }
}

export class GetDisplayManifestUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      contentStorage: ContentStorage;
      displayRepository: DisplayRepository;
      systemSettingRepository: SystemSettingRepository;
      downloadUrlExpiresInSeconds: number;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { displayId: string; now: Date }) {
    await this.deps.displayRepository.touchSeen?.(input.displayId, input.now);
    const [display, schedules] = await Promise.all([
      this.deps.displayRepository.findById(input.displayId),
      this.deps.scheduleRepository.listByDisplay(input.displayId),
    ]);
    if (!display) throw new NotFoundError("Display not found");
    const active = selectActiveSchedule(
      schedules,
      input.now,
      this.deps.scheduleTimeZone ?? "UTC",
    );

    if (!active) {
      const runtimeSettings = await this.getRuntimeSettings();
      return {
        playlistId: null,
        playlistVersion: "",
        generatedAt: input.now.toISOString(),
        runtimeSettings,
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

    const runtimeSettings = await this.getRuntimeSettings();

    const versionPayload = JSON.stringify({
      playlistId: playlist.id,
      refreshNonce: display.refreshNonce ?? 0,
      scrollPxPerSecond: runtimeSettings.scrollPxPerSecond,
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
      runtimeSettings,
      items: manifestItems,
    };
  }

  private async getRuntimeSettings(): Promise<{ scrollPxPerSecond: number }> {
    const setting = await this.deps.systemSettingRepository.findByKey(
      DISPLAY_RUNTIME_SCROLL_PX_PER_SECOND_KEY,
    );
    if (!setting) {
      return { scrollPxPerSecond: DEFAULT_RUNTIME_SCROLL_PX_PER_SECOND };
    }
    const parsed = Number.parseInt(setting.value, 10);
    return {
      scrollPxPerSecond:
        Number.isInteger(parsed) && parsed > 0
          ? parsed
          : DEFAULT_RUNTIME_SCROLL_PX_PER_SECOND,
    };
  }
}
