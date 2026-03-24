<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-24 -->

# http

## Purpose

HTTP interface implementation using Hono framework. Contains all API routes, middleware, request validators, audit queue, security stores, startup services, and shared HTTP utilities.

## Key Files

| File           | Description                                        |
| -------------- | -------------------------------------------------- |
| `responses.ts` | Response helper functions for consistent API shape |

## Subdirectories

| Directory     | Purpose                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `routes/`     | API route handlers organized by domain module (see `routes/AGENTS.md`)                                               |
| `middleware/` | Auth (JWT), permissions, CSRF, audit trail, observability middleware (see `middleware/AGENTS.md`)                    |
| `validators/` | Zod request schemas for each route module (see `validators/AGENTS.md`)                                               |
| `lib/`        | HTTP utilities — auth cookies, avatar URLs, constants, client IP extraction, session IDs, SSE helpers                |
| `audit/`      | Audit queue — `audit-queue.ts` (interface) and `redis-audit-queue.ts` (Redis-backed async audit log writing)         |
| `security/`   | Redis-backed auth security store (`redis-auth-security.store.ts`) for login rate limiting and lockout                |
| `startup/`    | Server startup services — admin identity, permission seeding, system role seeding, htshadow sync/watch/import/resync |

## For AI Agents

### Working In This Directory

- Routes use `@hono/standard-validator` for request validation with Zod schemas
- Auth middleware extracts JWT -> sets `c.var.user` context
- Permission middleware checks `c.var.user` against required permissions
- Audit trail middleware auto-logs HTTP requests to the audit queue
- Route handlers return via `responses.ts` helpers (ok, created, noContent, etc.)
- Startup services in `startup/` run during server initialization to seed permissions, roles, and sync htshadow users

### Common Patterns

- Each domain module has its own route file(s) in `routes/`
- Validators in `validators/` mirror route structure
- Routes receive use cases from bootstrap module factories
- OpenAPI metadata via `hono-openapi` decorators

<!-- MANUAL: -->
