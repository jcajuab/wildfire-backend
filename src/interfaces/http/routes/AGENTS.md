<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-24 -->

# routes

## Purpose

Hono route handlers organized by domain module. Each subdirectory defines API endpoints for one feature area. Routes validate input, call use cases, and return structured responses.

## Key Files

| File                    | Description                                  |
| ----------------------- | -------------------------------------------- |
| `health.route.ts`       | Health check endpoints (liveness, readiness) |
| `content-jobs.route.ts` | Content ingestion job status endpoints       |

## Subdirectories

| Directory          | Purpose                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `ai/`              | AI chat and credential management routes (`chat.route.ts`, `credentials.route.ts`)                 |
| `audit/`           | Audit log query and CSV export routes (`query.route.ts`, `export.route.ts`)                        |
| `auth/`            | Login, session, invitation, password, profile, avatar routes                                       |
| `content/`         | Content CRUD, file upload/download, PDF crop routes (`crud.route.ts`, `file.route.ts`, etc.)       |
| `display-runtime/` | Display-facing runtime API (auth, heartbeat, manifest, stream, snapshot)                           |
| `displays/`        | Staff-facing display management with `staff/` sub-routes (groups, events, registration, overrides) |
| `playlists/`       | Playlist CRUD and item management routes (`crud.route.ts`, `items.route.ts`)                       |
| `rbac/`            | User, role, and permission management routes                                                       |
| `schedules/`       | Schedule command and query routes (`command.route.ts`, `query.route.ts`)                           |
| `shared/`          | Shared route utilities — error handling (`error-handling.ts`), OpenAPI response helpers            |

## For AI Agents

### Working In This Directory

- Each route module has a `shared.ts` for module-specific types and an `index.ts` that assembles sub-routes
- Routes receive use cases from bootstrap module factories — no direct infrastructure access
- Use `@hono/standard-validator` with Zod schemas from `validators/` for request validation
- Two separate display APIs: `display-runtime/` (display devices call) vs `displays/` (staff manage)
- `displays/` uses a `staff/` subdirectory for granular route files (groups, events, registration attempts, overrides)
- `display-runtime/` has its own `deps.ts`, `contracts.ts`, and `middleware.ts` for display auth

### Common Patterns

- Route factory functions take dependencies, return Hono router
- Error handling via `shared/error-handling.ts` (maps AppError -> HTTP status)
- Consistent response shapes via `responses.ts` helpers

<!-- MANUAL: -->
