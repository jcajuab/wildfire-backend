export interface ContentCleanupFailureLog {
  route: string;
  contentId: string;
  fileKey: string;
  failurePhase: "upload_rollback_delete" | "delete_after_metadata_remove";
  error: unknown;
}

export interface CleanupFailureLogger {
  logContentCleanupFailure(input: ContentCleanupFailureLog): void;
}
