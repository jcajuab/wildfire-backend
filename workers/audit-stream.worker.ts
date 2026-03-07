import { runAuditStreamWorkerMain } from "#/bootstrap/workers/audit";

if (import.meta.main) {
  const exitCode = await runAuditStreamWorkerMain();
  process.exit(exitCode);
}
