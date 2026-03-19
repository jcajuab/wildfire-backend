<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-19 -->

# scripts

## Purpose

Utility scripts for database management and maintenance tasks.

## Subdirectories

| Directory | Purpose                                               |
| --------- | ----------------------------------------------------- |
| `db/`     | Database scripts (drop-all-tables for dev/test reset) |

## For AI Agents

### Working In This Directory

- Scripts are run directly with `bun run` (e.g., `bun run scripts/db/drop-all-tables.ts -- --force`)
- Destructive operations require `--force` flag

<!-- MANUAL: -->
