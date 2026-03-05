export type ContentIngestionJobOperation = "UPLOAD" | "REPLACE";
export type ContentIngestionJobStatus =
  | "QUEUED"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED";

export interface ContentIngestionJobRecord {
  id: string;
  contentId: string;
  operation: ContentIngestionJobOperation;
  status: ContentIngestionJobStatus;
  errorMessage: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ContentIngestionJobRepository {
  create(input: {
    id: string;
    contentId: string;
    operation: ContentIngestionJobOperation;
    status: ContentIngestionJobStatus;
    errorMessage?: string | null;
    createdById: string;
  }): Promise<ContentIngestionJobRecord>;
  findById(id: string): Promise<ContentIngestionJobRecord | null>;
  update(
    id: string,
    input: {
      status?: ContentIngestionJobStatus;
      errorMessage?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    },
  ): Promise<ContentIngestionJobRecord | null>;
}

export interface ContentIngestionQueue {
  enqueue(input: { jobId: string }): Promise<void>;
}

export type ContentJobEventType =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed";

export interface ContentJobEvent {
  type: ContentJobEventType;
  jobId: string;
  contentId: string;
  timestamp: string;
  status: ContentIngestionJobStatus;
  message?: string;
  errorMessage?: string;
}

export interface ContentJobEventPublisher {
  publish(event: ContentJobEvent): void;
}
