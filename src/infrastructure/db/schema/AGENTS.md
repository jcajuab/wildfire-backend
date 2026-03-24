<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-24 -->

# schema

## Purpose

Drizzle ORM table definitions for MySQL. Each `.sql.ts` file defines one or more related tables using Drizzle's schema builder. Used by both the query builder (repositories) and drizzle-kit (schema sync/migrations).

## Key Files

| File                     | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `ai-credentials.sql.ts`  | AI provider credentials table                    |
| `audit-logs.sql.ts`      | Audit log events table                           |
| `auth-state.sql.ts`      | Auth sessions and invitations tables             |
| `content.sql.ts`         | Content entities table                           |
| `content-job.sql.ts`     | Content ingestion jobs table                     |
| `display-key.sql.ts`     | Display cryptographic keys table                 |
| `displays.sql.ts`        | Displays and display groups tables               |
| `password-hashes.sql.ts` | Password hash storage table                      |
| `playlist.sql.ts`        | Playlists table                                  |
| `playlist-item.sql.ts`   | Playlist item join table                         |
| `rbac.sql.ts`            | Users, roles, permissions, and assignment tables |
| `runtime-control.sql.ts` | Runtime control flags table                      |
| `schedule.sql.ts`        | Schedules table                                  |

## For AI Agents

### Working In This Directory

- Use `mysqlTable()` from `drizzle-orm/mysql-core` for table definitions
- Column types: `varchar`, `text`, `int`, `boolean`, `datetime`, `json`
- Schema changes can be applied via `bun run db:push` (dev) or `bun run db:migrate` (prod)
- Relations are defined alongside tables for Drizzle's relational query builder

<!-- MANUAL: -->
