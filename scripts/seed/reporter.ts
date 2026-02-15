import { type SeedStageResult } from "./stage-types";

export interface SeedReporter {
  onStageStart(name: string): void;
  onStageComplete(
    name: string,
    durationMs: number,
    result: SeedStageResult,
  ): void;
  onStageError(name: string, durationMs: number, error: unknown): void;
  onRunComplete(durationMs: number, results: SeedStageResult[]): void;
}

export const consoleSeedReporter: SeedReporter = {
  onStageStart(name) {
    console.log(`[seed] start: ${name}`);
  },
  onStageComplete(name, durationMs, result) {
    const notes =
      result.notes && result.notes.length > 0
        ? ` notes=${result.notes.join(" | ")}`
        : "";
    console.log(
      `[seed] done: ${name} created=${result.created} updated=${result.updated} skipped=${result.skipped} durationMs=${durationMs}${notes}`,
    );
  },
  onStageError(name, durationMs, error) {
    console.error(`[seed] failed: ${name} durationMs=${durationMs}`);
    console.error(error);
  },
  onRunComplete(durationMs, results) {
    const created = results.reduce((sum, current) => sum + current.created, 0);
    const updated = results.reduce((sum, current) => sum + current.updated, 0);
    const skipped = results.reduce((sum, current) => sum + current.skipped, 0);
    console.log(
      `[seed] complete created=${created} updated=${updated} skipped=${skipped} durationMs=${durationMs}`,
    );
  },
};
