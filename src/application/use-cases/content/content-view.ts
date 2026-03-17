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
  createdAt: string;
  updatedAt: string;
  owner: {
    id: string;
    name: string;
  };
}

export const toContentView = (
  record: ContentRecord,
  ownerName: string | null,
  input?: {
    thumbnailUrl?: string;
  },
): ContentView => ({
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
  textJsonContent: record.textJsonContent ?? null,
  textHtmlContent: record.textHtmlContent ?? null,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt ?? record.createdAt,
  owner: {
    id: record.ownerId,
    name: ownerName ?? "Unknown",
  },
});
