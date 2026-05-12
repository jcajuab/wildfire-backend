import { type AIToolResult } from "#/application/ports/ai";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: UnknownRecord, key: string): string | undefined => {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
};

const readNumber = (value: UnknownRecord, key: string): number | undefined => {
  const field = value[key];
  return typeof field === "number" ? field : undefined;
};

const readBoolean = (
  value: UnknownRecord,
  key: string,
): boolean | undefined => {
  const field = value[key];
  return typeof field === "boolean" ? field : undefined;
};

const truncate = (value: string | undefined, maxLength = 180) => {
  if (!value) return undefined;
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3).trimEnd()}...`
    : value;
};

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const contentStatusLabel = (value: UnknownRecord) => {
  const status = readString(value, "status");
  if (status === "PROCESSING") return "Processing";
  if (status === "FAILED") return "Failed";
  if (status === "READY") {
    return readBoolean(value, "isUsedInPlaylist") ? "In Use" : "Draft";
  }
  return status ?? "Unknown";
};

export const summarizeContentForAI = (value: unknown) => {
  if (!isRecord(value)) return value;

  const type = readString(value, "type");
  const summary: UnknownRecord = {
    id: readString(value, "id"),
    title: readString(value, "title"),
    type,
    status: readString(value, "status"),
    statusLabel: contentStatusLabel(value),
  };

  const duration = readNumber(value, "duration");
  if (duration != null) summary.durationSeconds = duration;

  const width = readNumber(value, "width");
  const height = readNumber(value, "height");
  if (width != null && height != null) {
    summary.dimensions = `${width}x${height}`;
  }

  if (type === "FLASH") {
    summary.message = truncate(readString(value, "flashMessage"), 120);
    summary.tone = readString(value, "flashTone");
  } else if (type === "TEXT") {
    summary.preview = truncate(readString(value, "textPreviewText"));
  }

  return summary;
};

export const summarizeDisplayForAI = (value: unknown) => {
  if (!isRecord(value)) return value;
  return {
    id: readString(value, "id"),
    name: readString(value, "name"),
    slug: readString(value, "slug"),
    status: readString(value, "status"),
    output: readString(value, "output"),
    lastSeenAt: readString(value, "lastSeenAt") ?? null,
  };
};

export const summarizePlaylistForAI = (value: unknown) => {
  if (!isRecord(value)) return value;
  const summary: UnknownRecord = {
    id: readString(value, "id"),
    name: readString(value, "name"),
    status: readString(value, "status") ?? "DRAFT",
    showCounter: readBoolean(value, "showCounter") ?? false,
  };

  const description = readString(value, "description");
  if (description) summary.description = truncate(description);

  const itemsCount = readNumber(value, "itemsCount");
  if (itemsCount != null) summary.itemsCount = itemsCount;

  const totalDuration = readNumber(value, "totalDuration");
  if (totalDuration != null) summary.totalDurationSeconds = totalDuration;

  return summary;
};

export const summarizeScheduleForAI = (value: unknown) => {
  if (!isRecord(value)) return value;
  const summary: UnknownRecord = {
    id: readString(value, "id"),
    name: readString(value, "name"),
    kind: readString(value, "kind") ?? "PLAYLIST",
    displayId: readString(value, "displayId"),
    startDate: readString(value, "startDate"),
    endDate: readString(value, "endDate"),
    startTime: readString(value, "startTime"),
    endTime: readString(value, "endTime"),
  };

  const playlist = value.playlist;
  if (isRecord(playlist)) {
    summary.playlist = {
      id: readString(playlist, "id"),
      name: readString(playlist, "name"),
    };
  } else {
    const playlistId = readString(value, "playlistId");
    if (playlistId) summary.playlistId = playlistId;
  }

  const content = value.content;
  if (isRecord(content)) {
    summary.content = {
      id: readString(content, "id"),
      title: readString(content, "title"),
      type: readString(content, "type"),
      tone: readString(content, "flashTone"),
      message: truncate(readString(content, "flashMessage"), 120),
    };
  } else {
    const contentId = readString(value, "contentId");
    if (contentId) summary.contentId = contentId;
  }

  const display = value.display;
  if (isRecord(display)) {
    summary.display = {
      id: readString(display, "id"),
      name: readString(display, "name"),
    };
  }

  return summary;
};

export const aiSuccess = (message: string, data?: unknown): AIToolResult => ({
  success: true,
  message,
  data,
});

export const summarizeList = <T>(
  items: readonly T[],
  singular: string,
  mapper: (item: T) => unknown,
) =>
  aiSuccess(`Found ${pluralize(items.length, singular)}.`, items.map(mapper));

export const summarizeCreated = (
  resource: string,
  name: string | undefined,
  data: unknown,
) => aiSuccess(`Created ${resource}${name ? ` "${name}"` : ""}.`, data);

export const summarizeUpdated = (
  resource: string,
  name: string | undefined,
  data: unknown,
) => aiSuccess(`Updated ${resource}${name ? ` "${name}"` : ""}.`, data);

export const summarizeDeleted = (resource: string, id: string) =>
  aiSuccess(`Deleted ${resource}.`, { id, deleted: true });
