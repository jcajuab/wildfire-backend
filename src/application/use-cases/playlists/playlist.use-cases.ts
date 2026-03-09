import { ValidationError } from "#/application/errors/validation";
import { type ContentRepository } from "#/application/ports/content";
import { type DisplayStreamEventPublisher } from "#/application/ports/display-stream-events";
import { type DisplayRepository } from "#/application/ports/displays";
import {
  type PlaylistItemRecord,
  type PlaylistRepository,
} from "#/application/ports/playlists";
import { type UserRepository } from "#/application/ports/rbac";
import { type ScheduleRepository } from "#/application/ports/schedules";
import {
  computePlaylistEffectiveDuration,
  DEFAULT_SCROLL_PX_PER_SECOND,
} from "#/application/use-cases/shared/playlist-effective-duration";
import {
  isValidDuration,
  isValidSequence,
  type PlaylistStatus,
} from "#/domain/playlists/playlist";
import { NotFoundError, PlaylistInUseError } from "./errors";
import { toPlaylistItemView, toPlaylistView } from "./playlist-view";

const publishPlaylistUpdateEvents = async (
  deps: {
    scheduleRepository?: ScheduleRepository;
    displayEventPublisher?: DisplayStreamEventPublisher;
  },
  playlistId: string,
  reason: string,
) => {
  if (!deps.scheduleRepository || !deps.displayEventPublisher) {
    return;
  }
  const schedules = await deps.scheduleRepository.list();
  const impactedDisplayIds = Array.from(
    new Set(
      schedules
        .filter((schedule) => schedule.playlistId === playlistId)
        .map((schedule) => schedule.displayId),
    ),
  );
  for (const displayId of impactedDisplayIds) {
    deps.displayEventPublisher.publish({
      type: "playlist_updated",
      displayId,
      reason,
    });
  }
};

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
  displayWidth: number;
  displayHeight: number;
  scrollPxPerSecond: number;
}) => {
  const items = await input.playlistRepository.listItems(input.playlistId);
  const result = await computePlaylistEffectiveDuration({
    items: items.map((item) => ({
      contentId: item.contentId,
      duration: item.duration,
    })),
    contentRepository: input.contentRepository,
    displayWidth: input.displayWidth,
    displayHeight: input.displayHeight,
    defaultScrollPxPerSecond: input.scrollPxPerSecond,
  });
  return result.effectiveDurationSeconds;
};

const invalidateImpactedSchedules = async (
  deps: {
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    scheduleRepository?: ScheduleRepository;
    displayRepository?: DisplayRepository;
    displayEventPublisher?: DisplayStreamEventPublisher;
  },
  playlistId: string,
): Promise<void> => {
  if (!deps.scheduleRepository || !deps.displayRepository) {
    return;
  }
  const scrollPxPerSecond = DEFAULT_SCROLL_PX_PER_SECOND;
  const schedules = await deps.scheduleRepository.list();
  const impacted = schedules.filter(
    (schedule) => schedule.playlistId === playlistId && schedule.isActive,
  );
  for (const schedule of impacted) {
    const display = await deps.displayRepository.findById(schedule.displayId);
    if (
      !display ||
      typeof display.screenWidth !== "number" ||
      typeof display.screenHeight !== "number"
    ) {
      continue;
    }
    const displayWidth = display.screenWidth;
    const displayHeight = display.screenHeight;
    const required = await computeRequiredMinDurationSeconds({
      playlistRepository: deps.playlistRepository,
      contentRepository: deps.contentRepository,
      playlistId,
      displayWidth,
      displayHeight,
      scrollPxPerSecond,
    });
    const windowSeconds = scheduleWindowDurationSeconds(
      schedule.startTime,
      schedule.endTime,
    );
    if (windowSeconds < required) {
      await deps.scheduleRepository.update(schedule.id, { isActive: false });
      deps.displayEventPublisher?.publish({
        type: "schedule_updated",
        displayId: schedule.displayId,
        reason: "schedule_auto_disabled_due_to_playlist_duration",
      });
    }
  }
};

const runPlaylistPostMutationEffects = async (
  deps: {
    playlistRepository: PlaylistRepository;
    contentRepository: ContentRepository;
    scheduleRepository?: ScheduleRepository;
    displayRepository?: DisplayRepository;
    displayEventPublisher?: DisplayStreamEventPublisher;
  },
  playlistId: string,
  reason: string,
): Promise<void> => {
  // Item mutations are the primary operation; downstream notifications and
  // schedule invalidation should not fail an already-committed write.
  await Promise.allSettled([
    publishPlaylistUpdateEvents(deps, playlistId, reason),
    invalidateImpactedSchedules(deps, playlistId),
  ]);
};

export class EstimatePlaylistDurationUseCase {
  constructor(
    private readonly deps: {
      contentRepository: ContentRepository;
      displayRepository: DisplayRepository;
    },
  ) {}

  async execute(input: {
    displayId: string;
    items: readonly {
      contentId: string;
      duration: number;
      sequence: number;
    }[];
  }) {
    const display = await this.deps.displayRepository.findById(input.displayId);
    if (!display) {
      throw new NotFoundError("Display not found");
    }
    if (
      typeof display.screenWidth !== "number" ||
      typeof display.screenHeight !== "number"
    ) {
      throw new ValidationError("Display resolution is required");
    }

    for (const item of input.items) {
      if (!isValidSequence(item.sequence)) {
        throw new ValidationError("Invalid sequence");
      }
      if (!isValidDuration(item.duration)) {
        throw new ValidationError("Invalid duration");
      }
    }

    const result = await computePlaylistEffectiveDuration({
      items: [...input.items]
        .sort((left, right) => left.sequence - right.sequence)
        .map((item) => ({
          contentId: item.contentId,
          duration: item.duration,
        })),
      contentRepository: this.deps.contentRepository,
      displayWidth: display.screenWidth,
      displayHeight: display.screenHeight,
      defaultScrollPxPerSecond: DEFAULT_SCROLL_PX_PER_SECOND,
    });

    return result;
  }
}

export class ListPlaylistOptionsUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
    },
  ) {}

  async execute(input?: { q?: string; status?: PlaylistStatus }) {
    const normalizedQuery = input?.q?.trim().toLowerCase();

    return (await this.deps.playlistRepository.list())
      .filter((playlist) => {
        if (input?.status && playlist.status !== input.status) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        return (
          playlist.name.toLowerCase().includes(normalizedQuery) ||
          (playlist.description?.toLowerCase().includes(normalizedQuery) ??
            false)
        );
      })
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
      }));
  }
}

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
      scheduleRepository: ScheduleRepository;
      displayRepository: DisplayRepository;
    },
  ) {}

  async execute(input: { id: string }) {
    const schedules = await this.deps.scheduleRepository.listByPlaylistId(
      input.id,
    );
    if (schedules.length > 0) {
      const displayIds = Array.from(new Set(schedules.map((s) => s.displayId)));
      const displays = await this.deps.displayRepository.findByIds(displayIds);
      const firstDisplay = displays[0];
      const displayName =
        displays.length === 0 || !firstDisplay
          ? "a display"
          : firstDisplay.name?.trim() || firstDisplay.slug || "a display";
      const message =
        displayIds.length > 1
          ? "Failed to delete playlist. This playlist is in use by multiple displays."
          : `Failed to delete playlist. This playlist is in use by ${displayName}.`;
      throw new PlaylistInUseError(message);
    }

    const deleted = await this.deps.playlistRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Playlist not found");
  }
}

export class AddPlaylistItemUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      scheduleRepository?: ScheduleRepository;
      displayRepository?: DisplayRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
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
    if (content.status !== "READY") {
      throw new ValidationError(
        "Only ready content can be added to playlists.",
      );
    }
    if (content.kind === "PAGE" && content.isExcluded) {
      throw new ValidationError(
        "Excluded PDF pages cannot be added to playlists.",
      );
    }

    const existingItems = await this.deps.playlistRepository.listItems(
      input.playlistId,
    );
    const existingContentIds = Array.from(
      new Set(existingItems.map((item) => item.contentId)),
    );
    const existingContents =
      existingContentIds.length > 0
        ? await this.deps.contentRepository.findByIds(existingContentIds)
        : [];
    const hasParentPdfRefs = existingContents.some(
      (existingContent) =>
        existingContent.type === "PDF" && existingContent.kind === "ROOT",
    );
    const hasChildPdfRefs = existingContents.some(
      (existingContent) =>
        existingContent.type === "PDF" && existingContent.kind === "PAGE",
    );
    const incomingIsParentPdf =
      content.type === "PDF" && content.kind === "ROOT";
    const incomingIsChildPdf =
      content.type === "PDF" && content.kind === "PAGE";
    if (
      (incomingIsParentPdf && hasChildPdfRefs) ||
      (incomingIsChildPdf && hasParentPdfRefs)
    ) {
      throw new ValidationError(
        "Cannot mix PDF documents and PDF pages in the same playlist.",
      );
    }
    if (existingItems.some((item) => item.sequence === input.sequence)) {
      throw new ValidationError("Sequence already exists in playlist");
    }

    const item = await this.deps.playlistRepository.addItem({
      playlistId: input.playlistId,
      contentId: input.contentId,
      sequence: input.sequence,
      duration: input.duration,
    });
    await runPlaylistPostMutationEffects(
      this.deps,
      input.playlistId,
      "playlist_item_added",
    );

    return toPlaylistItemView(item, content);
  }
}

export class UpdatePlaylistItemUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      scheduleRepository?: ScheduleRepository;
      displayRepository?: DisplayRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
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
    await runPlaylistPostMutationEffects(
      this.deps,
      item.playlistId,
      "playlist_item_updated",
    );

    return toPlaylistItemView(item, content);
  }
}

export class ReorderPlaylistItemsUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      scheduleRepository?: ScheduleRepository;
      displayRepository?: DisplayRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: {
    playlistId: string;
    orderedItemIds: readonly string[];
  }) {
    const playlist = await this.deps.playlistRepository.findById(
      input.playlistId,
    );
    if (!playlist) {
      throw new NotFoundError("Playlist not found");
    }
    const reordered = await this.deps.playlistRepository.reorderItems({
      playlistId: input.playlistId,
      orderedItemIds: input.orderedItemIds,
    });
    if (!reordered) {
      throw new ValidationError("Invalid playlist reorder payload");
    }

    await runPlaylistPostMutationEffects(
      this.deps,
      input.playlistId,
      "playlist_items_reordered",
    );
  }
}

export class ReplacePlaylistItemsAtomicUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      scheduleRepository?: ScheduleRepository;
      displayRepository?: DisplayRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
    },
  ) {}

  async execute(input: {
    playlistId: string;
    items: readonly (
      | {
          kind: "existing";
          itemId: string;
          duration: number;
        }
      | {
          kind: "new";
          contentId: string;
          duration: number;
        }
    )[];
  }) {
    if (!this.deps.playlistRepository.replaceItemsAtomic) {
      throw new Error("Atomic playlist item replacement is not supported");
    }

    const playlist = await this.deps.playlistRepository.findById(
      input.playlistId,
    );
    if (!playlist) {
      throw new NotFoundError("Playlist not found");
    }

    for (const item of input.items) {
      if (!isValidDuration(item.duration)) {
        throw new ValidationError("Invalid duration");
      }
    }

    const existingItems = await this.deps.playlistRepository.listItems(
      input.playlistId,
    );
    const existingById = new Map(existingItems.map((item) => [item.id, item]));

    const seenExistingIds = new Set<string>();
    const requestedContentIds: string[] = [];
    for (const item of input.items) {
      if (item.kind === "existing") {
        if (seenExistingIds.has(item.itemId)) {
          throw new ValidationError("Duplicate playlist item id");
        }
        seenExistingIds.add(item.itemId);
        const existing = existingById.get(item.itemId);
        if (!existing) {
          throw new ValidationError("Invalid playlist item payload");
        }
        requestedContentIds.push(existing.contentId);
        continue;
      }
      requestedContentIds.push(item.contentId);
    }

    const uniqueContentIds = Array.from(new Set(requestedContentIds));
    const contents =
      uniqueContentIds.length > 0
        ? await this.deps.contentRepository.findByIds(uniqueContentIds)
        : [];
    const contentById = new Map(
      contents.map((content) => [content.id, content]),
    );
    for (const contentId of uniqueContentIds) {
      if (!contentById.has(contentId)) {
        throw new NotFoundError("Content not found");
      }
    }

    for (const item of input.items) {
      if (item.kind !== "new") {
        continue;
      }
      const content = contentById.get(item.contentId);
      if (!content) {
        throw new NotFoundError("Content not found");
      }
      if (content.status !== "READY") {
        throw new ValidationError(
          "Only ready content can be added to playlists.",
        );
      }
      if (content.kind === "PAGE" && content.isExcluded) {
        throw new ValidationError(
          "Excluded PDF pages cannot be added to playlists.",
        );
      }
    }

    const hasParentPdfRefs = contents.some(
      (content) => content.type === "PDF" && content.kind === "ROOT",
    );
    const hasChildPdfRefs = contents.some(
      (content) => content.type === "PDF" && content.kind === "PAGE",
    );
    if (hasParentPdfRefs && hasChildPdfRefs) {
      throw new ValidationError(
        "Cannot mix PDF documents and PDF pages in the same playlist.",
      );
    }

    const replaced = await this.deps.playlistRepository.replaceItemsAtomic({
      playlistId: input.playlistId,
      items: input.items,
    });
    await runPlaylistPostMutationEffects(
      this.deps,
      input.playlistId,
      "playlist_items_replaced",
    );

    const replacedContentIds = Array.from(
      new Set(replaced.map((item) => item.contentId)),
    );
    const replacedContents =
      replacedContentIds.length > 0
        ? await this.deps.contentRepository.findByIds(replacedContentIds)
        : [];
    const replacedContentById = new Map(
      replacedContents.map((content) => [content.id, content]),
    );

    return replaced.map((item) => {
      const content = replacedContentById.get(item.contentId);
      if (!content) {
        throw new NotFoundError("Content not found");
      }
      return toPlaylistItemView(item, content);
    });
  }
}

export class DeletePlaylistItemUseCase {
  constructor(
    private readonly deps: {
      playlistRepository: PlaylistRepository;
      contentRepository: ContentRepository;
      scheduleRepository?: ScheduleRepository;
      displayRepository?: DisplayRepository;
      displayEventPublisher?: DisplayStreamEventPublisher;
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
    void references;
    await runPlaylistPostMutationEffects(
      this.deps,
      existing.playlistId,
      "playlist_item_deleted",
    );
  }
}
