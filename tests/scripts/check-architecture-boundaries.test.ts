import { describe, expect, test } from "bun:test";
import {
  classifyLayerFromPath,
  findBoundaryViolations,
  type ImportRecord,
  isBoundaryViolation,
  resolveImportTargetLayer,
} from "../../scripts/check-architecture-boundaries";

describe("check-architecture-boundaries", () => {
  test("classifies layers from source paths", () => {
    expect(classifyLayerFromPath("/repo/src/domain/content/entity.ts")).toBe(
      "domain",
    );
    expect(
      classifyLayerFromPath("/repo/src/application/use-cases/foo.ts"),
    ).toBe("application");
    expect(classifyLayerFromPath("/repo/src/interfaces/http/index.ts")).toBe(
      "interfaces",
    );
    expect(
      classifyLayerFromPath(
        "/repo/src/infrastructure/db/repositories/user.repo.ts",
      ),
    ).toBe("infrastructure");
  });

  test("resolves alias and relative import target layers", () => {
    const sourceFile = "/repo/src/application/use-cases/foo.ts";

    expect(
      resolveImportTargetLayer(sourceFile, "#/domain/content/content"),
    ).toBe("domain");
    expect(
      resolveImportTargetLayer(sourceFile, "#/infrastructure/db/client"),
    ).toBe("infrastructure");
    expect(resolveImportTargetLayer(sourceFile, "./helpers/bar")).toBe(
      "application",
    );
    expect(resolveImportTargetLayer(sourceFile, "zod")).toBeNull();
  });

  test("flags violations for forbidden dependency directions", () => {
    expect(isBoundaryViolation("domain", "application")).toBe(true);
    expect(isBoundaryViolation("domain", "infrastructure")).toBe(true);
    expect(isBoundaryViolation("application", "interfaces")).toBe(true);
    expect(isBoundaryViolation("application", "infrastructure")).toBe(true);
    expect(isBoundaryViolation("application", "domain")).toBe(false);
    expect(isBoundaryViolation("domain", "domain")).toBe(false);
  });

  test("findBoundaryViolations returns only invalid imports", () => {
    const records: ImportRecord[] = [
      {
        sourceFile: "/repo/src/application/use-cases/a.ts",
        sourceLayer: "application",
        specifier: "#/domain/content/content",
        targetLayer: "domain",
      },
      {
        sourceFile: "/repo/src/application/use-cases/b.ts",
        sourceLayer: "application",
        specifier: "#/interfaces/http/routes/x",
        targetLayer: "interfaces",
      },
      {
        sourceFile: "/repo/src/domain/content/entity.ts",
        sourceLayer: "domain",
        specifier: "#/application/ports/content",
        targetLayer: "application",
      },
    ];

    const violations = findBoundaryViolations(records);

    expect(violations).toHaveLength(2);
    expect(violations.map((entry) => entry.specifier)).toEqual([
      "#/interfaces/http/routes/x",
      "#/application/ports/content",
    ]);
  });
});
