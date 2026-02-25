import { type SeedMode } from "./args";
import { type SeedReporter } from "./reporter";
import {
  type SeedContext,
  type SeedStage,
  type SeedStageResult,
} from "./stage-types";
import { runAssignDemoRoles } from "./stages/assign-demo-roles";
import { runAssignRootEmail } from "./stages/assign-root-email";
import { runSeedDemoRoles } from "./stages/seed-demo-roles";
import { runSeedDemoUsers } from "./stages/seed-demo-users";
import { runSeedRoot } from "./stages/seed-root";
import { runSeedStandardPermissions } from "./stages/seed-standard-permissions";
import { runSyncHtshadow } from "./stages/sync-htshadow";

export const buildSeedStages = (mode: SeedMode): SeedStage[] => {
  if (mode === "permissions-only") {
    return [
      {
        name: "seed-standard-permissions",
        execute: runSeedStandardPermissions,
      },
      { name: "seed-root", execute: runSeedRoot },
    ];
  }

  if (mode === "root-only") {
    return [
      { name: "seed-root", execute: runSeedRoot },
      { name: "assign-root-email", execute: runAssignRootEmail },
    ];
  }

  if (mode === "baseline") {
    return [
      {
        name: "seed-standard-permissions",
        execute: runSeedStandardPermissions,
      },
      { name: "seed-root", execute: runSeedRoot },
      { name: "assign-root-email", execute: runAssignRootEmail },
    ];
  }

  return [
    {
      name: "seed-standard-permissions",
      execute: runSeedStandardPermissions,
    },
    { name: "seed-root", execute: runSeedRoot },
    { name: "seed-demo-roles", execute: runSeedDemoRoles },
    { name: "seed-demo-users", execute: runSeedDemoUsers },
    { name: "assign-demo-roles", execute: runAssignDemoRoles },
    { name: "sync-htshadow", execute: runSyncHtshadow },
    { name: "assign-root-email", execute: runAssignRootEmail },
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
