import { type SeedStageResult } from "./stage-types";

export interface SeedReporter {
  onRunStart?(runId: string, isDryRun: boolean): void;
  onStageStart(name: string, runId?: string): void;
  onStageComplete(
    name: string,
    durationMs: number,
    result: SeedStageResult,
    runId?: string,
  ): void;
  onStageError(
    name: string,
    durationMs: number,
    error: unknown,
    runId?: string,
  ): void;
  onRunComplete(
    durationMs: number,
    results: SeedStageResult[],
    runId?: string,
  ): void;
}

export const consoleSeedReporter: SeedReporter = {
  onRunStart(runId, isDryRun) {
    const mode = isDryRun ? "dry-run" : "apply";
    const marker = runId ? `[seed][${runId}]` : "[seed]";
    console.log(`${marker} start: mode=${mode}`);
  },
  onStageStart(name, runId) {
    const marker = runId ? `[seed][${runId}]` : "[seed]";
    console.log(`${marker} start: ${name}`);
  },
  onStageComplete(name, durationMs, result, runId) {
    const notes =
      result.notes && result.notes.length > 0
        ? ` notes=${result.notes.join(" | ")}`
        : "";
    const marker = runId ? `[seed][${runId}]` : "[seed]";
    console.log(
      `${marker} done: ${name} created=${result.created} updated=${result.updated} skipped=${result.skipped} durationMs=${durationMs}${notes}`,
    );
  },
  onStageError(name, durationMs, error, runId) {
    const marker = runId ? `[seed][${runId}]` : "[seed]";
    console.error(`${marker} failed: ${name} durationMs=${durationMs}`);
    console.error(error);
  },
  onRunComplete(durationMs, results, runId) {
    const created = results.reduce((sum, current) => sum + current.created, 0);
    const updated = results.reduce((sum, current) => sum + current.updated, 0);
    const skipped = results.reduce((sum, current) => sum + current.skipped, 0);
    const marker = runId ? `[seed][${runId}]` : "[seed]";
    console.log(
      `${marker} complete created=${created} updated=${updated} skipped=${skipped} durationMs=${durationMs}`,
    );
  },
};
