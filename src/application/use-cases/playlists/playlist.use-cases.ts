import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DeviceStreamEventPublisher } from "#/application/ports/device-stream-events";
import { type DeviceRepository } from "#/application/ports/devices";
import {
  type PlaylistItemRecord,
  type PlaylistRepository,
} from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  isValidDuration,
  isValidSequence,
  type PlaylistStatus,
} from "#/domain/playlists/playlist";
import { NotFoundError } from "./errors";
import { toPlaylistItemView, toPlaylistView } from "./playlist-view";

const publishPlaylistUpdateEvents = async (
  deps: {
    scheduleRepository?: ScheduleRepository;
    deviceEventPublisher?: DeviceStreamEventPublisher;
  },
  playlistId: string,
  reason: string,
) => {
  if (!deps.scheduleRepository || !deps.deviceEventPublisher) {
    return;
  }
  const schedules = await deps.scheduleRepository.list();
  const impactedDeviceIds = Array.from(
    new Set(
      schedules
        .filter((schedule) => schedule.playlistId === playlistId)
        .map((schedule) => schedule.deviceId),
    ),
  );
  for (const deviceId of impactedDeviceIds) {
    deps.deviceEventPublisher.publish({
      type: "playlist_updated",
      deviceId,
      reason,
    });
  }
};

const OVERFLOW_SCROLL_PIXELS_PER_SECOND = 24;

const parseTimeToSeconds = (value: string): number => {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number.parseInt(hourRaw ?? "", 10);
  const minute = Number.parseInt(minuteRaw ?? "", 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return 0;
  }
  return hour * 3600 + minute * 60;
};

const scheduleWindowDurationSeconds = (startTime: string, endTime: string) => {
  const startSeconds = parseTimeToSeconds(startTime);
  const endSeconds = parseTimeToSeconds(endTime);
  if (endSeconds > startSeconds) return endSeconds - startSeconds;
  if (endSeconds < startSeconds) return 24 * 3600 - startSeconds + endSeconds;
  return 0;
};

const computeRequiredMinDurationSeconds = async (input: {
  playlistRepository: PlaylistRepository;
  contentRepository: ContentRepository;
  playlistId: string;
  deviceWidth: number;
  deviceHeight: number;
}) => {
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
      overflowExtra += Math.ceil(overflow / OVERFLOW_SCROLL_PIXELS_PER_SECOND);
    }
  }
  return baseDuration + overflowExtra;
};

const invalidateImpactedSchedules = async (
  deps: {
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    scheduleRepository?: ScheduleRepository;
    deviceRepository?: DeviceRepository;
    deviceEventPublisher?: DeviceStreamEventPublisher;
  },
  playlistId: string,
): Promise<void> => {
  if (!deps.scheduleRepository || !deps.deviceRepository) {
    return;
  }
  const schedules = await deps.scheduleRepository.list();
  const impacted = schedules.filter(
    (schedule) => schedule.playlistId === playlistId && schedule.isActive,
  );
  for (const schedule of impacted) {
    const device = await deps.deviceRepository.findById(schedule.deviceId);
    if (
      !device ||
      typeof device.screenWidth !== "number" ||
      typeof device.screenHeight !== "number"
    ) {
      continue;
    }
    const deviceWidth = device.screenWidth;
    const deviceHeight = device.screenHeight;
    const required = await computeRequiredMinDurationSeconds({
      playlistRepository: deps.playlistRepository,
      contentRepository: deps.contentRepository,
      playlistId,
      deviceWidth,
      deviceHeight,
    });
    const windowSeconds = scheduleWindowDurationSeconds(
      schedule.startTime,
      schedule.endTime,
    );
    if (windowSeconds < required) {
      await deps.scheduleRepository.update(schedule.id, { isActive: false });
      deps.deviceEventPublisher?.publish({
        type: "schedule_updated",
        deviceId: schedule.deviceId,
        reason: "schedule_auto_disabled_due_to_playlist_duration",
      });
    }
  }
};

export class ListPlaylistsUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input?: {
    page?: number;
    pageSize?: number;
    status?: PlaylistStatus;
    search?: string;
    sortBy?: "updatedAt" | "name";
    sortDirection?: "asc" | "desc";
  }) {
    const page = Math.max(Math.trunc(input?.page ?? 1), 1);
    const pageSize = Math.min(
      Math.max(Math.trunc(input?.pageSize ?? 20), 1),
      100,
    );
    const offset = (page - 1) * pageSize;

    const { items: playlists, total } =
      await this.deps.playlistRepository.listPage({
        offset,
        limit: pageSize,
        status: input?.status,
        search: input?.search,
        sortBy: input?.sortBy,
        sortDirection: input?.sortDirection,
      });
    const creatorIds = Array.from(
      new Set(playlists.map((item) => item.createdById)),
    );
    const creators = await this.deps.userRepository.findByIds(creatorIds);
    const creatorsById = new Map(creators.map((user) => [user.id, user]));

    const playlistIds = playlists.map((playlist) => playlist.id);
    const statsByPlaylistId = this.deps.playlistRepository
      .listItemStatsByPlaylistIds
      ? await this.deps.playlistRepository.listItemStatsByPlaylistIds(
          playlistIds,
        )
      : await this.buildStatsByPlaylistId(playlistIds);

    const items = playlists.map((playlist) =>
      toPlaylistView(
        playlist,
        creatorsById.get(playlist.createdById)?.name ?? null,
        statsByPlaylistId.get(playlist.id),
      ),
    );

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  private async buildStatsByPlaylistId(playlistIds: string[]) {
    const statsByPlaylistId = new Map<
      string,
      { itemsCount: number; totalDuration: number }
    >();
    await Promise.all(
      playlistIds.map(async (playlistId) => {
        const items = await this.deps.playlistRepository.listItems(playlistId);
        statsByPlaylistId.set(playlistId, {
          itemsCount: items.length,
          totalDuration: items.reduce((sum, item) => sum + item.duration, 0),
        });
      }),
    );
    return statsByPlaylistId;
  }
}

export class CreatePlaylistUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: {
    name: string;
    description?: string | null;
    createdById: string;
  }) {
    const creator = await this.deps.userRepository.findById(input.createdById);
    if (!creator) {
      throw new NotFoundError("User not found");
    }

    const playlist = await this.deps.playlistRepository.create({
      name: input.name,
      description: input.description ?? null,
      createdById: input.createdById,
    });
    return toPlaylistView(playlist, creator.name, {
      itemsCount: 0,
      totalDuration: 0,
    });
  }
}

export class GetPlaylistUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: { id: string }) {
    const playlist = await this.deps.playlistRepository.findById(input.id);
    if (!playlist) throw new NotFoundError("Playlist not found");

    const items = await this.deps.playlistRepository.listItems(input.id);
    const itemViews = await this.buildItems(items);

    const creator = await this.deps.userRepository.findById(
      playlist.createdById,
    );
    return {
      ...toPlaylistView(playlist, creator?.name ?? null, {
        itemsCount: itemViews.length,
        totalDuration: itemViews.reduce((sum, item) => sum + item.duration, 0),
      }),
      items: itemViews,
    };
  }

  private async buildItems(items: PlaylistItemRecord[]) {
    const contentIds = Array.from(new Set(items.map((item) => item.contentId)));
    const contents = await this.deps.contentRepository.findByIds(contentIds);
    const contentById = new Map(
      contents.map((content) => [content.id, content]),
    );

    const views = [] as ReturnType<typeof toPlaylistItemView>[];
    for (const item of items) {
      const content = contentById.get(item.contentId);
      if (!content) {
        throw new NotFoundError("Content not found");
      }
      views.push(toPlaylistItemView(item, content));
    }
    return views;
  }
}

export class UpdatePlaylistUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      userRepository: UserRepository;
    },
  ) {}

  async execute(input: {
    id: string;
    name?: string;
    description?: string | null;
  }) {
    const playlist = await this.deps.playlistRepository.update(input.id, {
      name: input.name,
      description: input.description,
    });
    if (!playlist) throw new NotFoundError("Playlist not found");

    const creator = await this.deps.userRepository.findById(
      playlist.createdById,
    );
    const items = await this.deps.playlistRepository.listItems(playlist.id);
    return toPlaylistView(playlist, creator?.name ?? null, {
      itemsCount: items.length,
      totalDuration: items.reduce((sum, item) => sum + item.duration, 0),
    });
  }
}

export class DeletePlaylistUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
    },
  ) {}

  async execute(input: { id: string }) {
    const playlistItems = await this.deps.playlistRepository.listItems(
      input.id,
    );
    const deleted = await this.deps.playlistRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Playlist not found");

    const affectedContentIds = Array.from(
      new Set(playlistItems.map((item) => item.contentId)),
    );
    await Promise.all(
      affectedContentIds.map(async (contentId) => {
        const references =
          await this.deps.playlistRepository.countItemsByContentId(contentId);
        if (references === 0) {
          await this.deps.contentRepository.update(contentId, {
            status: "DRAFT",
          });
        }
      }),
    );
  }
}

export class AddPlaylistItemUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      scheduleRepository?: ScheduleRepository;
      deviceRepository?: DeviceRepository;
      deviceEventPublisher?: DeviceStreamEventPublisher;
    },
  ) {}

  async execute(input: {
    playlistId: string;
    contentId: string;
    sequence: number;
    duration: number;
  }) {
    if (!isValidSequence(input.sequence)) {
      throw new ValidationError("Invalid sequence");
    }
    if (!isValidDuration(input.duration)) {
      throw new ValidationError("Invalid duration");
    }

    const playlist = await this.deps.playlistRepository.findById(
      input.playlistId,
    );
    if (!playlist) throw new NotFoundError("Playlist not found");

    const content = await this.deps.contentRepository.findById(input.contentId);
    if (!content) throw new NotFoundError("Content not found");

    const existingItems = await this.deps.playlistRepository.listItems(
      input.playlistId,
    );
    if (existingItems.some((item) => item.sequence === input.sequence)) {
      throw new ValidationError("Sequence already exists in playlist");
    }

    const item = await this.deps.playlistRepository.addItem({
      playlistId: input.playlistId,
      contentId: input.contentId,
      sequence: input.sequence,
      duration: input.duration,
    });
    await this.deps.contentRepository.update(input.contentId, {
      status: "IN_USE",
    });
    await publishPlaylistUpdateEvents(
      this.deps,
      input.playlistId,
      "playlist_item_added",
    );
    await invalidateImpactedSchedules(this.deps, input.playlistId);

    return toPlaylistItemView(item, content);
  }
}

export class UpdatePlaylistItemUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      scheduleRepository?: ScheduleRepository;
      deviceRepository?: DeviceRepository;
      deviceEventPublisher?: DeviceStreamEventPublisher;
    },
  ) {}

  async execute(input: { id: string; sequence?: number; duration?: number }) {
    if (input.sequence !== undefined && !isValidSequence(input.sequence)) {
      throw new ValidationError("Invalid sequence");
    }
    if (input.duration !== undefined && !isValidDuration(input.duration)) {
      throw new ValidationError("Invalid duration");
    }

    const item = await this.deps.playlistRepository.updateItem(input.id, {
      sequence: input.sequence,
      duration: input.duration,
    });
    if (!item) throw new NotFoundError("Playlist item not found");

    const content = await this.deps.contentRepository.findById(item.contentId);
    if (!content) throw new NotFoundError("Content not found");
    await publishPlaylistUpdateEvents(
      this.deps,
      item.playlistId,
      "playlist_item_updated",
    );
    await invalidateImpactedSchedules(this.deps, item.playlistId);

    return toPlaylistItemView(item, content);
  }
}

export class DeletePlaylistItemUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      scheduleRepository?: ScheduleRepository;
      deviceRepository?: DeviceRepository;
      deviceEventPublisher?: DeviceStreamEventPublisher;
    },
  ) {}

  async execute(input: { id: string }) {
    const existing = await this.deps.playlistRepository.findItemById(input.id);
    if (!existing) throw new NotFoundError("Playlist item not found");

    const deleted = await this.deps.playlistRepository.deleteItem(input.id);
    if (!deleted) throw new NotFoundError("Playlist item not found");

    const references = await this.deps.playlistRepository.countItemsByContentId(
      existing.contentId,
    );
    if (references === 0) {
      await this.deps.contentRepository.update(existing.contentId, {
        status: "DRAFT",
      });
    }
    await publishPlaylistUpdateEvents(
      this.deps,
      existing.playlistId,
      "playlist_item_deleted",
    );
    await invalidateImpactedSchedules(this.deps, existing.playlistId);
  }
}
