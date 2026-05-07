import { type ContentRecord } from "#/application/ports/content";
import { type ContentStatus, type ContentType } from "#/domain/content/content";

export interface ContentView {
  id: string;
  title: string;
  type: ContentType;
  status: ContentStatus;
  thumbnailUrl?: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  flashMessage: string | null;
  flashTone: "INFO" | "WARNING" | "CRITICAL" | null;
  textJsonContent: string | null;
  textHtmlContent: string | null;
  textPreviewText: string | null;
  createdAt: string;
  updatedAt: string;
  owner: {
    id: string;
    username: string;
    name: string;
  };
}

export type ContentListItemView = Omit<
  ContentView,
  "textJsonContent" | "textHtmlContent"
>;

interface ContentOwnerViewInput {
  name: string;
  username: string;
}

interface ContentOwnerFallbackInput {
  id: string;
  name?: string;
  username: string;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, token) => {
    const normalized = String(token).toLowerCase();
    const namedEntities: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    if (normalized in namedEntities) {
      return namedEntities[normalized] ?? entity;
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

export function getTextPreviewText(
  html: string | null | undefined,
): string | null {
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

function resolveOwner(
  record: ContentRecord,
  owner: ContentOwnerViewInput | null,
  fallbackOwner?: ContentOwnerFallbackInput | null,
) {
  const fallback = fallbackOwner?.id === record.ownerId ? fallbackOwner : null;
  const resolvedOwner =
    owner ??
    (fallback
      ? {
          username: fallback.username,
          name: fallback.name ?? fallback.username,
        }
      : null);

  return {
    id: record.ownerId,
    username: resolvedOwner?.username ?? "unknown",
    name: resolvedOwner?.name ?? "Unknown",
  };
}

function contentViewBase(
  record: ContentRecord,
  owner: ContentOwnerViewInput | null,
  input?: {
    fallbackOwner?: ContentOwnerFallbackInput | null;
    thumbnailUrl?: string;
  },
) {
  return {
    id: record.id,
    title: record.title,
    type: record.type,
    status: record.status,
    thumbnailUrl: input?.thumbnailUrl,
    mimeType: record.mimeType,
    fileSize: record.fileSize,
    checksum: record.checksum,
    width: record.width,
    height: record.height,
    duration: record.duration,
    flashMessage: record.flashMessage ?? null,
    flashTone: record.flashTone ?? null,
    textPreviewText: getTextPreviewText(record.textHtmlContent),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
    owner: resolveOwner(record, owner, input?.fallbackOwner),
  };
}

export const toContentView = (
  record: ContentRecord,
  owner: ContentOwnerViewInput | null,
  input?: {
    fallbackOwner?: ContentOwnerFallbackInput | null;
    thumbnailUrl?: string;
  },
): ContentView => {
  return {
    ...contentViewBase(record, owner, input),
    textJsonContent: record.textJsonContent ?? null,
    textHtmlContent: record.textHtmlContent ?? null,
  };
};

export const toContentListItemView = (
  record: ContentRecord,
  owner: ContentOwnerViewInput | null,
  input?: {
    fallbackOwner?: ContentOwnerFallbackInput | null;
    thumbnailUrl?: string;
  },
): ContentListItemView => contentViewBase(record, owner, input);
