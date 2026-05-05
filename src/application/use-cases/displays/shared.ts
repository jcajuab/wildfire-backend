import {
  type DisplayRecord,
  type DisplayRepository,
  type DisplayStatus,
} from "#/application/ports/displays";

export type ManifestRenderableType = "IMAGE" | "VIDEO" | "TEXT";

export function withTelemetry(display: DisplayRecord) {
  const lastSeenAt = display.lastSeenAt ?? null;
  return {
    ...display,
    output: display.output,
    lastSeenAt,
    status: display.status,
  } as const;
}

export const listDisplaysWithFallback = (input: {
  displayRepository: DisplayRepository;
  offset: number;
  limit: number;
  q?: string;
  status?: DisplayStatus;
  output?: string;
  groupIds?: string[];
  sortBy?: "name" | "status";
  sortDirection?: "asc" | "desc";
}): Promise<{ items: DisplayRecord[]; total: number }> =>
  input.displayRepository.searchPage({
    offset: input.offset,
    limit: input.limit,
    q: input.q,
    status: input.status,
    output: input.output,
    groupIds: input.groupIds,
    sortBy: input.sortBy,
    sortDirection: input.sortDirection,
  });

export const isRenderableEmergencyAsset = (content: {
  type: string;
  status: string;
}): content is {
  type: ManifestRenderableType;
  status: "READY";
} =>
  (content.type === "IMAGE" ||
    content.type === "VIDEO" ||
    content.type === "TEXT") &&
  content.status === "READY";
