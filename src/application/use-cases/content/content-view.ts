import { type ContentRecord } from "#/application/ports/content";
import { type ContentStatus, type ContentType } from "#/domain/content/content";

export interface ContentView {
  id: string;
  title: string;
  type: ContentType;
  status: ContentStatus;
  mimeType: string;
  fileSize: number;
  checksum: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: string;
  createdBy: {
    id: string;
    name: string;
  };
}

export const toContentView = (
  record: ContentRecord,
  creatorName: string | null,
): ContentView => ({
  id: record.id,
  title: record.title,
  type: record.type,
  status: record.status,
  mimeType: record.mimeType,
  fileSize: record.fileSize,
  checksum: record.checksum,
  width: record.width,
  height: record.height,
  duration: record.duration,
  createdAt: record.createdAt,
  createdBy: {
    id: record.createdById,
    name: creatorName ?? "Unknown",
  },
});
