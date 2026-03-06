import { sql } from "drizzle-orm";
import { env } from "#/env";
import { db } from "#/infrastructure/db/client";

type SchemaObjectRow = {
  objectName: string;
  objectType: string;
};

export const parseDropArgs = (argv: string[]) => {
  const force = argv.includes("--force");
  const unknownFlags = argv.filter(
    (arg) => arg.startsWith("--") && arg !== "--force",
  );

  if (unknownFlags.length > 0) {
    throw new Error(`Unknown flag(s): ${unknownFlags.join(", ")}`);
  }

  return { force };
};

const toRows = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const candidate = value as { rows?: unknown };
    if (Array.isArray(candidate.rows)) {
      return candidate.rows;
    }
  }

  return [];
};

const normalizeSchemaObjects = (value: unknown): SchemaObjectRow[] => {
  const rows = toRows(value);
  const parsed: SchemaObjectRow[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const candidate = row as {
      objectName?: unknown;
      objectType?: unknown;
      TABLE_NAME?: unknown;
      TABLE_TYPE?: unknown;
    };
    const objectName =
      typeof candidate.objectName === "string"
        ? candidate.objectName
        : typeof candidate.TABLE_NAME === "string"
          ? candidate.TABLE_NAME
          : null;
    const objectType =
      typeof candidate.objectType === "string"
        ? candidate.objectType
        : typeof candidate.TABLE_TYPE === "string"
          ? candidate.TABLE_TYPE
          : null;
    if (!objectName || !objectType) {
      continue;
    }

    parsed.push({ objectName, objectType });
  }

  return parsed;
};

const normalizeCount = (value: unknown): number => {
  const rows = toRows(value);
  const first = rows[0];
  if (!first || typeof first !== "object") {
    return 0;
  }

  const candidate = first as {
    remainingCount?: unknown;
    count?: unknown;
  };
  const rawValue =
    candidate.remainingCount !== undefined
      ? candidate.remainingCount
      : candidate.count;
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
};

const quoteIdentifier = (value: string): string =>
  `\`${value.replaceAll("`", "``")}\``;

const listSchemaObjects = async (): Promise<SchemaObjectRow[]> => {
  const result = await db.execute(sql`
    SELECT TABLE_NAME AS objectName, TABLE_TYPE AS objectType
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ${env.MYSQL_DATABASE}
  `);

  return normalizeSchemaObjects(result);
};

const listObjectNamesByType = async (type: string): Promise<string[]> => {
  const objects = await listSchemaObjects();
  return objects
    .filter((object) => object.objectType === type)
    .map((object) => object.objectName)
    .sort((a, b) => a.localeCompare(b));
};

const countRemainingSchemaObjects = async (): Promise<number> => {
  const result = await db.execute(sql`
    SELECT COUNT(*) AS remainingCount
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ${env.MYSQL_DATABASE}
  `);

  return normalizeCount(result);
};

async function main(): Promise<void> {
  const args = parseDropArgs(process.argv.slice(2));
  if (!args.force) {
    console.error(
      "Refusing to drop tables without --force. Example: bun run db:drop -- --force",
    );
    process.exit(2);
  }

  const views = await listObjectNamesByType("VIEW");
  const tables = await listObjectNamesByType("BASE TABLE");

  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  try {
    for (const view of views) {
      await db.execute(sql.raw(`DROP VIEW IF EXISTS ${quoteIdentifier(view)}`));
      console.log(`Dropped view: ${view}`);
    }

    for (const table of tables) {
      await db.execute(
        sql.raw(`DROP TABLE IF EXISTS ${quoteIdentifier(table)}`),
      );
      console.log(`Dropped table: ${table}`);
    }
  } finally {
    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
  }

  if (views.length === 0) {
    console.log("No views found in schema.");
  }
  if (tables.length === 0) {
    console.log("No tables found in schema.");
  }

  const remainingCount = await countRemainingSchemaObjects();
  if (remainingCount > 0) {
    const remainingObjects = await listSchemaObjects();
    const remainingNames = remainingObjects
      .map((object) => `${object.objectType}:${object.objectName}`)
      .join(", ");
    throw new Error(
      `Hard drop failed. ${remainingCount} schema object(s) remain in \`${env.MYSQL_DATABASE}\`: ${remainingNames}`,
    );
  }

  console.log(
    `Done. Hard drop complete for schema \`${env.MYSQL_DATABASE}\` (${views.length} view(s), ${tables.length} table(s)).`,
  );
}

if (import.meta.main) {
  let exitCode = 0;
  try {
    await main();
  } catch (error) {
    exitCode = 1;
    console.error(error);
  }

  process.exit(exitCode);
}
