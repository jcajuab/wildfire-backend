import { type ContentRecord } from "#/application/ports/content";
import { type ContentStatus, type ContentType } from "#/domain/content/content";

export interface ContentView {
  id: string;
  title: string;
  type: ContentType;
  kind: "ROOT" | "PAGE";
  status: ContentStatus;
  thumbnailUrl?: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  parentContentId: string | null;
  pageNumber: number | null;
  pageCount: number | null;
  isExcluded: boolean;
  width: number | null;
  height: number | null;
  duration: number | null;
  scrollPxPerSecond: number | null;
  flashMessage: string | null;
  flashTone: "INFO" | "WARNING" | "CRITICAL" | null;
  createdAt: string;
  createdBy: {
    id: string;
    name: string;
  };
}

export const toContentView = (
  record: ContentRecord,
  creatorName: string | null,
  input?: {
    thumbnailUrl?: string;
  },
): ContentView => ({
  id: record.id,
  title: record.title,
  type: record.type,
  kind: record.kind ?? "ROOT",
  status: record.status,
  thumbnailUrl: input?.thumbnailUrl,
  mimeType: record.mimeType,
  fileSize: record.fileSize,
  checksum: record.checksum,
  parentContentId: record.parentContentId ?? null,
  pageNumber: record.pageNumber ?? null,
  pageCount: record.pageCount ?? null,
  isExcluded: record.isExcluded ?? false,
  width: record.width,
  height: record.height,
  duration: record.duration,
  scrollPxPerSecond: record.scrollPxPerSecond ?? null,
  flashMessage: record.flashMessage ?? null,
  flashTone: record.flashTone ?? null,
  createdAt: record.createdAt,
  createdBy: {
    id: record.createdById,
    name: creatorName ?? "Unknown",
  },
});
