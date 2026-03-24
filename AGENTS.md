<!-- Generated: 2026-03-24 -->

# Wildfire Backend

## Purpose

Digital signage management system backend. Serves an HTTP API for managing displays, content, playlists, schedules, users/roles, and AI-assisted signage operations. Built on Bun runtime with Hono framework, following Clean Architecture (domain -> application -> infrastructure -> interfaces -> bootstrap).

## Key Files

| File                | Description                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `htshadow`          | **Read-only** shadow-style password file for DCISM users (managed externally). Wildfire must not write to it; invited users are stored in the DB only. |
| `src/index.ts`      | HTTP server entrypoint — bootstraps app, starts Bun.serve()                                                                                            |
| `src/env.ts`        | Environment variable validation via @t3-oss/env-core                                                                                                   |
| `package.json`      | Dependencies and scripts (bun runtime, hono, drizzle, ai SDK)                                                                                          |
| `tsconfig.json`     | TypeScript config — strict mode, `#/*` path alias to `./src/*`                                                                                         |
| `biome.json`        | Linter/formatter config (Biome)                                                                                                                        |
| `drizzle.config.ts` | Drizzle ORM config for MySQL — schema in `src/infrastructure/db/schema/*.sql.ts`                                                                       |
| `compose.yaml`      | Docker Compose for local dev (MySQL, Redis, MinIO)                                                                                                     |
| `bunfig.toml`       | Bun config — test preload, module resolution                                                                                                           |
| `lefthook.yaml`     | Git hooks configuration (pre-commit, pre-push)                                                                                                         |

## Subdirectories

| Directory  | Purpose                                                                            |
| ---------- | ---------------------------------------------------------------------------------- |
| `src/`     | Application source code (see `src/AGENTS.md`)                                      |
| `tests/`   | Test suites — unit, integration, architecture (see `tests/AGENTS.md`)              |
| `workers/` | Background worker entrypoints (audit, content ingestion) (see `workers/AGENTS.md`) |
| `scripts/` | Utility scripts (database management) (see `scripts/AGENTS.md`)                    |
| `docs/`    | Documentation (database schema, DCISM auth, logging best practices)                |
| `drizzle/` | Drizzle migration output (generated SQL files from `drizzle-kit generate`)         |
| `out/`     | Compiled build output (git-ignored)                                                |

## For AI Agents

### Working In This Directory

- Path alias: `#/` maps to `./src/` — always use `#/` imports in source code
- Runtime is **Bun** (not Node.js) — use `bun run`, `bun test`, Bun APIs
- Formatter/linter is **Biome** (`bun run check`), not ESLint/Prettier
- Database is **MySQL** via Drizzle ORM — supports both `db:push` (dev) and `db:migrate` (prod)
- Three processes run concurrently: API server, audit worker, content ingestion worker

### Testing Requirements

- `bun run check` — Biome lint + format
- `bun run test` — all unit tests
- `bun run build` — typecheck + bundle (must pass before committing)
- `bun run test:integration` — integration tests (requires running MySQL/Redis/MinIO)

### Common Patterns

- Clean Architecture layers: domain -> application (ports + use-cases) -> infrastructure -> interfaces -> bootstrap
- Dependency injection via constructor/factory functions, no DI container
- Zod v4 for all validation (API schemas, env vars, AI tool schemas)
- Repository pattern for data access (ports define interfaces, infrastructure implements)

### Auth and credentials

- **htshadow** is read-only from Wildfire's perspective. DCISM users are synced from the htshadow file; Wildfire only reads it for login and resyncs the user directory when the file changes. Do not write to htshadow from application code.
- **Invite flow**: creating an invitation and accepting it create users and credentials only in the application DB (`password_hashes` table via `DbCredentialsRepository`). Invited users are wildfire-specific, not added to htshadow.

## Dependencies

### External

- `hono` — HTTP framework
- `ai` (Vercel AI SDK v6) — AI chat with tool calling
- `drizzle-orm` + `mysql2` — Database ORM
- `redis` — Caching, job queues, auth sessions, event bus
- `@aws-sdk/client-s3` — Content storage (MinIO-compatible)
- `zod` v4 — Schema validation
- `pino` — Structured logging
- `bcryptjs` — Password hashing
- `pdf-lib` — PDF manipulation (crop, page extraction)
- `image-size` — Image dimension extraction
- `fluent-ffmpeg` / `ffprobe-static` — Video metadata extraction

<!-- MANUAL: -->
