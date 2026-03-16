<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-16 -->

# workers (bootstrap)

## Purpose

Bootstrap logic for background worker processes. Configures Redis stream consumers, job processors, and DLQ management for async task processing.

## Subdirectories

| Directory            | Purpose                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| `audit/`             | Audit stream worker bootstrap — consumes audit events from Redis             |
| `content-ingestion/` | Content ingestion pipeline — processes uploaded files (metadata, thumbnails) |
| `shared/`            | Shared worker utilities (Redis stream parsing)                               |

## For AI Agents

### Working In This Directory

- Workers use Redis Streams (XREADGROUP) for reliable message consumption
- Content ingestion has a DLQ (dead letter queue) for failed jobs
- Each worker has its own composition root separate from the HTTP server

<!-- MANUAL: -->
