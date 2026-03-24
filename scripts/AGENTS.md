<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-24 -->

# scripts

## Purpose

Utility scripts for database management and maintenance tasks.

## Subdirectories

| Directory | Purpose                                                                                     |
| --------- | ------------------------------------------------------------------------------------------- |
| `db/`     | Database scripts — `drop-all-tables.ts` (dev reset), `set-admin.ts` (promote user to admin) |

## For AI Agents

### Working In This Directory

- Scripts are run directly with `bun run` (e.g., `bun run scripts/db/drop-all-tables.ts -- --force`)
- `set-admin` is run via `bun run db:set-admin` (npm script alias)
- Destructive operations require `--force` flag

<!-- MANUAL: -->
