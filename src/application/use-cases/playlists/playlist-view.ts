import { type ContentRecord } from "#/application/ports/content";
import {
  type PlaylistItemRecord,
  type PlaylistRecord,
} from "#/application/ports/playlists";
import { type UserRecord } from "#/application/ports/rbac";

type PlaylistOwnerViewInput = Pick<UserRecord, "name" | "username"> | null;

const HTML_ENTITY_MAP: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, token) => {
    const normalized = String(token).toLowerCase();
    if (normalized in HTML_ENTITY_MAP) {
      return HTML_ENTITY_MAP[normalized] ?? entity;
    }
    if (normalized.startsWith("#x")) {
      const parsed = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity;
    }
    if (normalized.startsWith("#")) {
      const parsed = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity;
    }
    return entity;
  });
}

function getTextPreviewText(html: string | null | undefined): string | null {
  if (!html) return null;
  const compactHtml = html.replace(/>\s+</g, "><");
  const withBreaks = compactHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6])>/gi, "\n");
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]*>/g, ""))
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length === 0) return null;
  return text.length > 500 ? `${text.slice(0, 497).trimEnd()}...` : text;
}

export const toPlaylistView = (
  playlist: PlaylistRecord,
  owner: PlaylistOwnerViewInput,
  stats?: { itemsCount: number; totalDuration: number },
  input?: {
    previewItems?: ReturnType<typeof toPlaylistItemView>[];
  },
) => ({
  id: playlist.id,
  name: playlist.name,
  description: playlist.description,
  status: playlist.status ?? "DRAFT",
  showCounter: playlist.showCounter ?? false,
  itemsCount: stats?.itemsCount ?? 0,
  totalDuration: stats?.totalDuration ?? 0,
  createdAt: playlist.createdAt,
  updatedAt: playlist.updatedAt,
  owner: {
    id: playlist.ownerId,
    username: owner?.username ?? "unknown",
    name: owner?.name ?? null,
  },
  ...(input && "previewItems" in input
    ? { previewItems: input.previewItems ?? [] }
    : {}),
});

export const toPlaylistItemView = (
  item: PlaylistItemRecord,
  content: ContentRecord,
  input?: {
    thumbnailUrl?: string | null;
  },
) => ({
  id: item.id,
  sequence: item.sequence,
  duration: item.duration,
  loop: item.loop,
  content: {
    id: content.id,
    title: content.title,
    type: content.type,
    checksum: content.checksum,
    thumbnailUrl: input?.thumbnailUrl ?? null,
    ...(content.type === "TEXT"
      ? { textPreviewText: getTextPreviewText(content.textHtmlContent) }
      : {}),
  },
});
