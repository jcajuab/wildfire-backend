import { type SeedReporter } from "./reporter";
import {
  type SeedContext,
  type SeedStage,
  type SeedStageResult,
} from "./stage-types";
import { runSeedRoot } from "./stages/seed-root";
import { runSeedStandardPermissions } from "./stages/seed-standard-permissions";

export const buildSeedStages = (): SeedStage[] => {
  return [
    {
      name: "seed-standard-permissions",
      execute: runSeedStandardPermissions,
    },
    { name: "seed-root", execute: runSeedRoot },
  ];
};

export async function runSeedStages(input: {
  ctx: SeedContext;
  stages: SeedStage[];
  reporter: SeedReporter;
}): Promise<SeedStageResult[]> {
  const runStart = Date.now();
  const results: SeedStageResult[] = [];

  for (const stage of input.stages) {
    const startedAt = Date.now();
    input.reporter.onStageStart(stage.name);

    try {
      const result = await stage.execute(input.ctx);
      const durationMs = Date.now() - startedAt;
      results.push(result);
      input.reporter.onStageComplete(stage.name, durationMs, result);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      input.reporter.onStageError(stage.name, durationMs, error);
      throw error;
    }
  }

  input.reporter.onRunComplete(Date.now() - runStart, results);
  return results;
}
