import { type SeedReporter } from "./reporter";
import {
  type SeedContext,
  type SeedStage,
  type SeedStageResult,
} from "./stage-types";
import { runCleanupDemoAuditEvents } from "./stages/cleanup-demo-audit-events";
import { runCleanupDemoContent } from "./stages/cleanup-demo-content";
import { runCleanupDemoDisplays } from "./stages/cleanup-demo-displays";
import { runCleanupDemoPlaylists } from "./stages/cleanup-demo-playlists";
import { runCleanupDemoRbac } from "./stages/cleanup-demo-rbac";
import { runCleanupDemoSchedules } from "./stages/cleanup-demo-schedules";
import { runSeedDemoAuditEvents } from "./stages/seed-demo-audit-events";
import { runSeedDemoContent } from "./stages/seed-demo-content";
import { runSeedDemoDisplays } from "./stages/seed-demo-displays";
import { runSeedDemoPlaylists } from "./stages/seed-demo-playlists";
import { runSeedDemoRbac } from "./stages/seed-demo-rbac";
import { runSeedDemoSchedules } from "./stages/seed-demo-schedules";

export const buildSeedStages = (): SeedStage[] => {
  return [
    { name: "seed-demo-rbac", execute: runSeedDemoRbac },
    { name: "seed-demo-displays", execute: runSeedDemoDisplays },
    { name: "seed-demo-content", execute: runSeedDemoContent },
    { name: "seed-demo-playlists", execute: runSeedDemoPlaylists },
    { name: "seed-demo-schedules", execute: runSeedDemoSchedules },
    { name: "seed-demo-audit-events", execute: runSeedDemoAuditEvents },
  ];
};

export const buildSeedCleanupStages = (): SeedStage[] => {
  return [
    { name: "cleanup-demo-audit-events", execute: runCleanupDemoAuditEvents },
    { name: "cleanup-demo-schedules", execute: runCleanupDemoSchedules },
    { name: "cleanup-demo-playlists", execute: runCleanupDemoPlaylists },
    { name: "cleanup-demo-content", execute: runCleanupDemoContent },
    { name: "cleanup-demo-displays", execute: runCleanupDemoDisplays },
    { name: "cleanup-demo-rbac", execute: runCleanupDemoRbac },
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
