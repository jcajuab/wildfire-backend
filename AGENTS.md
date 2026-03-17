<!-- Generated: 2026-03-16 | Updated: 2026-03-16 -->

# Wildfire Backend

## Purpose

Digital signage management system backend. Serves an HTTP API for managing displays, content, playlists, schedules, users/roles, and AI-assisted signage operations. Built on Bun runtime with Hono framework, following Clean Architecture (domain → application → infrastructure → interfaces).

## Key Files

| File                | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `htshadow`          | Shadow-style password file with bcrypt-hashed credentials for dev/test users |
| `src/index.ts`      | HTTP server entrypoint — bootstraps app, starts Bun.serve()                  |
| `src/env.ts`        | Environment variable validation via @t3-oss/env-core                         |
| `package.json`      | Dependencies and scripts (bun runtime, hono, drizzle, ai SDK)                |
| `tsconfig.json`     | TypeScript config — strict mode, `#/*` path alias to `./src/*`               |
| `biome.json`        | Linter/formatter config (Biome)                                              |
| `drizzle.config.ts` | Drizzle ORM config for MySQL schema push                                     |
| `compose.yaml`      | Docker Compose for local dev (MySQL, Redis, MinIO)                           |
| `bunfig.toml`       | Bun config — test preload, module resolution                                 |

## Subdirectories

| Directory  | Purpose                                                                            |
| ---------- | ---------------------------------------------------------------------------------- |
| `src/`     | Application source code (see `src/AGENTS.md`)                                      |
| `tests/`   | Test suites — unit, integration, architecture (see `tests/AGENTS.md`)              |
| `workers/` | Background worker entrypoints (audit, content ingestion) (see `workers/AGENTS.md`) |
| `scripts/` | Utility scripts (database management) (see `scripts/AGENTS.md`)                    |
| `docs/`    | Documentation (database schema, logging, auth reference)                           |
| `out/`     | Compiled build output (git-ignored)                                                |

## For AI Agents

### Working In This Directory

- Path alias: `#/` maps to `./src/` — always use `#/` imports in source code
- Runtime is **Bun** (not Node.js) — use `bun run`, `bun test`, Bun APIs
- Formatter/linter is **Biome** (`bun run check`), not ESLint/Prettier
- Database is **MySQL** via Drizzle ORM — schema push, no migrations
- Three processes run concurrently: API server, audit worker, content ingestion worker

### Testing Requirements

- `bun run check` — Biome lint + format
- `bun run test` — all unit tests
- `bun run build` — typecheck + bundle (must pass before committing)
- `bun run test:integration` — integration tests (requires running MySQL/Redis/MinIO)

### Common Patterns

- Clean Architecture layers: domain → application (ports + use-cases) → infrastructure → interfaces
- Dependency injection via constructor/factory functions, no DI container
- Zod for all validation (API schemas, env vars, AI tool schemas)
- Repository pattern for data access (ports define interfaces, infrastructure implements)

## Dependencies

### External

- `hono` — HTTP framework
- `ai` (Vercel AI SDK v6) — AI chat with tool calling
- `drizzle-orm` + `mysql2` — Database ORM
- `redis` — Caching, job queues, auth sessions
- `@aws-sdk/client-s3` — Content storage (MinIO-compatible)
- `zod` v4 — Schema validation
- `pino` — Structured logging
- `bcryptjs` — Password hashing

<!-- MANUAL: -->
