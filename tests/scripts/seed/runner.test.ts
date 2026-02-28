import { describe, expect, test } from "bun:test";
import { buildSeedStages, runSeedStages } from "../../../scripts/seed/runner";
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
  test("builds bootstrap stages", () => {
    const stages = buildSeedStages();
    expect(stages.map((stage) => stage.name)).toEqual([
      "seed-standard-permissions",
      "seed-root",
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
