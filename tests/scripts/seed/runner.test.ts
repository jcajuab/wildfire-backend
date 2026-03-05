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
  onStageStart(name: string) {
    this.started.push(name);
  },
  onStageComplete(name: string) {
    this.completed.push(name);
  },
  onStageError(name: string) {
    this.failed.push(name);
  },
  onRunComplete() {},
});

const fakeCtx = {} as SeedContext;

describe("buildSeedStages", () => {
  test("builds demo seed stages", () => {
    const stages = buildSeedStages();
    expect(stages.map((stage) => stage.name)).toEqual([
      "seed-demo-rbac",
      "seed-demo-displays",
      "seed-demo-content",
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
