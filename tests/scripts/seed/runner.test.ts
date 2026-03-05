import { describe, expect, test } from "bun:test";
import {
  buildSeedCleanupStages,
  buildSeedStages,
  runSeedStages,
} from "../../../scripts/seed/runner";
import {
  type SeedContext,
  type SeedStage,
  type SeedStageResult,
} from "../../../scripts/seed/stage-types";

const makeReporter = () => ({
  started: [] as string[],
  completed: [] as string[],
  failed: [] as string[],
  onRunStart(_runId: string, _isDryRun: boolean) {},
  onStageStart(name: string, _runId?: string) {
    this.started.push(name);
  },
  onStageComplete(
    name: string,
    _durationMs: number,
    _result: SeedStageResult,
    _runId?: string,
  ) {
    this.completed.push(name);
  },
  onStageError(
    name: string,
    _durationMs: number,
    _error: unknown,
    _runId?: string,
  ) {
    this.failed.push(name);
  },
  onRunComplete(
    _durationMs: number,
    _results: SeedStageResult[],
    _runId?: string,
  ) {},
});

const fakeCtx = { args: { dryRun: false } } as SeedContext;

describe("buildSeedStages", () => {
  test("builds demo seed stages", () => {
    const stages = buildSeedStages();
    expect(stages.map((stage) => stage.name)).toEqual([
      "seed-demo-permissions",
      "seed-demo-displays",
      "seed-demo-content",
      "seed-demo-content-jobs",
      "seed-demo-playlists",
      "seed-demo-schedules",
      "seed-demo-audit-events",
    ]);
  });
});

describe("buildSeedCleanupStages", () => {
  test("builds cleanup stages in dependency-safe order", () => {
    const stages = buildSeedCleanupStages();
    expect(stages.map((stage) => stage.name)).toEqual([
      "cleanup-demo-audit-events",
      "cleanup-demo-schedules",
      "cleanup-demo-playlists",
      "cleanup-demo-content",
      "cleanup-demo-displays",
      "cleanup-demo-rbac",
    ]);
  });
});

describe("runSeedStages", () => {
  test("stops immediately when a stage fails", async () => {
    const calls: string[] = [];

    const stages: SeedStage[] = [
      {
        name: "first",
        async execute() {
          calls.push("first");
          return {
            name: "first",
            created: 0,
            updated: 0,
            skipped: 1,
          } satisfies SeedStageResult;
        },
      },
      {
        name: "second",
        async execute() {
          calls.push("second");
          throw new Error("boom");
        },
      },
      {
        name: "third",
        async execute() {
          calls.push("third");
          return {
            name: "third",
            created: 0,
            updated: 0,
            skipped: 1,
          } satisfies SeedStageResult;
        },
      },
    ];

    const reporter = makeReporter();

    await expect(
      runSeedStages({
        ctx: fakeCtx,
        stages,
        reporter,
      }),
    ).rejects.toThrow("boom");

    expect(calls).toEqual(["first", "second"]);
    expect(reporter.started).toEqual(["first", "second"]);
    expect(reporter.completed).toEqual(["first"]);
    expect(reporter.failed).toEqual(["second"]);
  });
});
