<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-19 -->

# workers

## Purpose

Background worker entrypoints that run as separate Bun processes alongside the main API server. Each worker connects to Redis streams for async event processing.

## Key Files

| File                          | Description                                                   |
| ----------------------------- | ------------------------------------------------------------- |
| `audit-stream.worker.ts`      | Consumes audit events from Redis stream, persists to database |
| `content-ingestion.worker.ts` | Processes uploaded content (metadata extraction, thumbnails)  |

## For AI Agents

### Working In This Directory

- Workers are built separately: `bun build ... workers/audit-stream.worker.ts workers/content-ingestion.worker.ts`
- Started via `bun run dev:worker:audit` and `bun run dev:worker:content`
- Worker bootstrap logic lives in `src/bootstrap/workers/` — these files are just entrypoints
- Each worker has its own graceful shutdown handling

<!-- MANUAL: -->
