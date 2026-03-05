import { type ContentIngestionJobRecord } from "#/application/ports/content-jobs";

export interface ContentJobView {
  id: string;
  contentId: string;
  operation: "UPLOAD" | "REPLACE";
  status: "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
  errorMessage: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export const toContentJobView = (
  record: ContentIngestionJobRecord,
): ContentJobView => ({
  id: record.id,
  contentId: record.contentId,
  operation: record.operation,
  status: record.status,
  errorMessage: record.errorMessage,
  createdById: record.createdById,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  startedAt: record.startedAt,
  completedAt: record.completedAt,
});
