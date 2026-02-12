import { type SeedMode } from "./args";
import { type SeedReporter } from "./reporter";
import {
  type SeedContext,
  type SeedStage,
  type SeedStageResult,
} from "./stage-types";
import { runAssignDemoRoles } from "./stages/assign-demo-roles";
import { runAssignSuperAdminEmail } from "./stages/assign-super-admin-email";
import { runSeedDemoRoles } from "./stages/seed-demo-roles";
import { runSeedDemoUsers } from "./stages/seed-demo-users";
import { runSeedStandardPermissions } from "./stages/seed-standard-permissions";
import { runSeedSuperAdmin } from "./stages/seed-super-admin";
import { runSyncHtshadow } from "./stages/sync-htshadow";

export const buildSeedStages = (mode: SeedMode): SeedStage[] => {
  if (mode === "super-admin-only") {
    return [
      { name: "seed-super-admin", execute: runSeedSuperAdmin },
      { name: "assign-super-admin-email", execute: runAssignSuperAdminEmail },
    ];
  }

  if (mode === "baseline") {
    return [
      {
        name: "seed-standard-permissions",
        execute: runSeedStandardPermissions,
      },
      { name: "seed-super-admin", execute: runSeedSuperAdmin },
      { name: "assign-super-admin-email", execute: runAssignSuperAdminEmail },
    ];
  }

  return [
    {
      name: "seed-standard-permissions",
      execute: runSeedStandardPermissions,
    },
    { name: "seed-super-admin", execute: runSeedSuperAdmin },
    { name: "seed-demo-roles", execute: runSeedDemoRoles },
    { name: "seed-demo-users", execute: runSeedDemoUsers },
    { name: "assign-demo-roles", execute: runAssignDemoRoles },
    { name: "sync-htshadow", execute: runSyncHtshadow },
    { name: "assign-super-admin-email", execute: runAssignSuperAdminEmail },
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
