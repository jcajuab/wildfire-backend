import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Layer = "domain" | "application" | "interfaces" | "infrastructure";

export interface ImportRecord {
  sourceFile: string;
  sourceLayer: Layer;
  specifier: string;
  targetLayer: Layer | null;
}

export interface BoundaryViolation {
  sourceFile: string;
  sourceLayer: Layer;
  specifier: string;
  targetLayer: Layer;
}

const LAYER_PREFIXES: Array<{ layer: Layer; marker: string }> = [
  { layer: "domain", marker: `${path.sep}src${path.sep}domain${path.sep}` },
  {
    layer: "application",
    marker: `${path.sep}src${path.sep}application${path.sep}`,
  },
  {
    layer: "interfaces",
    marker: `${path.sep}src${path.sep}interfaces${path.sep}`,
  },
  {
    layer: "infrastructure",
    marker: `${path.sep}src${path.sep}infrastructure${path.sep}`,
  },
];

const normalizePath = (value: string) => value.replaceAll("/", path.sep);

export const classifyLayerFromPath = (value: string): Layer | null => {
  const normalized = normalizePath(value);
  for (const { layer, marker } of LAYER_PREFIXES) {
    if (normalized.includes(marker)) {
      return layer;
    }
  }
  return null;
};

const classifyLayerFromAlias = (specifier: string): Layer | null => {
  const match = specifier.match(
    /^#\/(domain|application|interfaces|infrastructure)(?:\/|$)/,
  );
  if (!match) {
    return null;
  }
  return match[1] as Layer;
};

export const resolveImportTargetLayer = (
  sourceFile: string,
  specifier: string,
): Layer | null => {
  if (specifier.startsWith("#/")) {
    return classifyLayerFromAlias(specifier);
  }

  if (specifier.startsWith(".")) {
    const resolved = path.resolve(path.dirname(sourceFile), specifier);
    return classifyLayerFromPath(resolved);
  }

  return null;
};

export const isBoundaryViolation = (
  sourceLayer: Layer,
  targetLayer: Layer | null,
): targetLayer is Layer => {
  if (targetLayer == null) {
    return false;
  }

  if (sourceLayer === "domain") {
    return (
      targetLayer === "application" ||
      targetLayer === "interfaces" ||
      targetLayer === "infrastructure"
    );
  }

  if (sourceLayer === "application") {
    return targetLayer === "interfaces" || targetLayer === "infrastructure";
  }

  return false;
};

const IMPORT_FROM_PATTERN = /\bfrom\s+["']([^"']+)["']/g;
const IMPORT_DYNAMIC_PATTERN = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

const extractImportSpecifiers = (source: string): string[] => {
  const result = new Set<string>();

  for (const pattern of [IMPORT_FROM_PATTERN, IMPORT_DYNAMIC_PATTERN]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      const specifier = match[1];
      if (specifier) {
        result.add(specifier);
      }
      match = pattern.exec(source);
    }
  }

  return [...result];
};

const collectTypeScriptFiles = (rootDir: string): string[] => {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
};

export const buildImportRecords = (files: string[]): ImportRecord[] => {
  const records: ImportRecord[] = [];

  for (const file of files) {
    const sourceLayer = classifyLayerFromPath(file);
    if (sourceLayer == null) {
      continue;
    }

    const source = readFileSync(file, "utf-8");
    const specifiers = extractImportSpecifiers(source);

    for (const specifier of specifiers) {
      records.push({
        sourceFile: file,
        sourceLayer,
        specifier,
        targetLayer: resolveImportTargetLayer(file, specifier),
      });
    }
  }

  return records;
};

export const findBoundaryViolations = (
  records: ImportRecord[],
): BoundaryViolation[] => {
  const violations: BoundaryViolation[] = [];

  for (const record of records) {
    if (!isBoundaryViolation(record.sourceLayer, record.targetLayer)) {
      continue;
    }

    violations.push({
      sourceFile: record.sourceFile,
      sourceLayer: record.sourceLayer,
      specifier: record.specifier,
      targetLayer: record.targetLayer,
    });
  }

  return violations;
};

export const scanArchitectureBoundaryViolations = (srcRoot: string) => {
  const files = [
    ...collectTypeScriptFiles(path.join(srcRoot, "domain")),
    ...collectTypeScriptFiles(path.join(srcRoot, "application")),
  ];
  const records = buildImportRecords(files);
  return findBoundaryViolations(records);
};

if (import.meta.main) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "..");
  const sourceRoot = path.join(projectRoot, "src");
  const violations = scanArchitectureBoundaryViolations(sourceRoot);

  if (violations.length === 0) {
    console.log("Architecture boundary check passed.");
    process.exit(0);
  }

  console.error("Architecture boundary violations found:");
  for (const violation of violations) {
    const relativePath = path.relative(projectRoot, violation.sourceFile);
    console.error(
      `- ${relativePath} (${violation.sourceLayer} -> ${violation.targetLayer}) imports "${violation.specifier}"`,
    );
  }

  process.exit(1);
}
