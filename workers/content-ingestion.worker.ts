import { runContentIngestionWorkerMain } from "#/bootstrap/workers/content-ingestion";

if (import.meta.main) {
  const exitCode = await runContentIngestionWorkerMain();
  process.exit(exitCode);
}
