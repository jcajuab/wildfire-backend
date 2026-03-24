<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-24 -->

# infrastructure

## Purpose

Concrete implementations of application ports. Adapters for external systems: MySQL (via Drizzle), Redis, S3/MinIO, AI providers (Vercel AI SDK), authentication (JWT, bcrypt), media processing, encryption, and observability (Pino logging).

## Subdirectories

| Directory        | Purpose                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `db/`            | Drizzle ORM client, schema definitions, repository implementations (see `db/AGENTS.md`)                                    |
| `redis/`         | Redis client, Lua script evaluation, hash utilities, display heartbeat store, event bus                                    |
| `storage/`       | S3-compatible content storage (MinIO) — `s3-content.storage.ts`                                                            |
| `ai/`            | Vercel AI SDK adapter (`vercel-ai-adapter.ts`) — wraps streamText() with tool definitions                                  |
| `auth/`          | JWT token issuer/verifier, bcrypt password hashing/verification, htshadow file reader                                      |
| `content-jobs/`  | Redis-based content ingestion job queue, job events, and event publishers                                                  |
| `crypto/`        | AI API key encryption service (`ai-key-encryption.service.ts`)                                                             |
| `displays/`      | Display SSE stream, registration attempt store, admin lifecycle events, registration attempt events, event publishers      |
| `media/`         | Content metadata extraction (ffprobe), thumbnail generation, PDF crop session store, PDF crop renderer, PDF page extractor |
| `observability/` | Pino logger setup, structured logging helpers, startup logging                                                             |
| `time/`          | System clock abstraction (`system.clock.ts`)                                                                               |

## For AI Agents

### Working In This Directory

- Each subdirectory implements one or more ports from `application/ports/`
- Repository implementations use Drizzle ORM query builder
- Redis operations use the shared client from `redis/client.ts`
- AI adapter wraps Vercel AI SDK's `streamText()` with tool definitions
- Display infrastructure handles both SSE streaming and Redis-backed state

### Common Patterns

- Repository classes implement port interfaces exactly
- Drizzle schema files (`.sql.ts`) define table structures
- Error mapping: DB constraint violations -> application errors
- Redis is used for: sessions, heartbeats, event bus, job queues, caching, audit streams

<!-- MANUAL: -->
