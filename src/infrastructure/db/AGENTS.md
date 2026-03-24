<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-24 -->

# db

## Purpose

MySQL database layer using Drizzle ORM. Contains the database client, table schema definitions, and repository implementations that fulfill application port interfaces.

## Key Files

| File        | Description                  |
| ----------- | ---------------------------- |
| `client.ts` | Drizzle MySQL client factory |

## Subdirectories

| Directory       | Purpose                                                                               |
| --------------- | ------------------------------------------------------------------------------------- |
| `schema/`       | Drizzle table definitions (`.sql.ts` files) — one per domain entity                   |
| `repositories/` | Repository implementations using Drizzle query builder (see `repositories/AGENTS.md`) |
| `utils/`        | Database utilities (SQL helpers)                                                      |

## For AI Agents

### Working In This Directory

- Schema files use Drizzle's `mysqlTable()` with typed columns
- Supports both `bun run db:push` (dev) and `bun run db:migrate` (prod via drizzle-kit)
- Repositories implement port interfaces from `application/ports/`
- `utils/sql.ts` provides SQL helper functions for complex queries

### Common Patterns

- Each repository file implements one port interface
- Queries use Drizzle's type-safe query builder (no raw SQL)
- Error mapping: unique constraint violations -> application-level errors

<!-- MANUAL: -->
