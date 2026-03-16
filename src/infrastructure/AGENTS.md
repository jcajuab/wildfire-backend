<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-16 -->

# infrastructure

## Purpose

Concrete implementations of application ports. Adapters for external systems: MySQL (via Drizzle), Redis, S3/MinIO, AI providers (Vercel AI SDK), authentication (JWT, bcrypt), media processing, and observability (Pino logging).

## Subdirectories

| Directory        | Purpose                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- |
| `db/`            | Drizzle ORM client, schema definitions, repository implementations (see `db/AGENTS.md`) |
| `redis/`         | Redis client, Lua script evaluation, hash utilities                                     |
| `storage/`       | S3-compatible content storage (MinIO)                                                   |
| `ai/`            | Vercel AI SDK adapter, Redis-backed pending action store                                |
| `auth/`          | JWT token issuer/verifier, bcrypt password hashing, htshadow file reader                |
| `content-jobs/`  | Redis-based content ingestion job queue and events                                      |
| `crypto/`        | AI API key encryption service                                                           |
| `displays/`      | Display SSE stream, registration attempt store, lifecycle events                        |
| `media/`         | Content metadata extraction (ffprobe) and thumbnail generation                          |
| `observability/` | Pino logger setup, structured logging helpers                                           |
| `time/`          | System clock abstraction                                                                |

## For AI Agents

### Working In This Directory

- Each subdirectory implements one or more ports from `application/ports/`
- Repository implementations use Drizzle ORM query builder
- Redis operations use the shared client from `redis/client.ts`
- AI adapter wraps Vercel AI SDK's `streamText()` with tool definitions

### Common Patterns

- Repository classes implement port interfaces exactly
- Drizzle schema files (`.sql.ts`) define table structures
- Error mapping: DB constraint violations → application errors

<!-- MANUAL: -->
