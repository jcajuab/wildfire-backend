<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-19 -->

# http

## Purpose

HTTP interface implementation using Hono framework. Contains all API routes, middleware, request validators, audit queue, security stores, startup services, and the DI container.

## Key Files

| File           | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| `container.ts` | Top-level HTTP DI container (creates all dependencies)          |
| `index.ts`     | Hono app assembly — mounts all route modules, global middleware |
| `responses.ts` | Response helper functions for consistent API shape              |

## Subdirectories

| Directory     | Purpose                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| `routes/`     | API route handlers organized by domain module (see `routes/AGENTS.md`)                    |
| `middleware/` | Auth (JWT), permissions, audit trail, observability middleware                            |
| `validators/` | Zod request schemas for each route module                                                 |
| `lib/`        | HTTP utilities (cookie handling, avatar URLs, constants, IP extraction, SSE, sessions)    |
| `audit/`      | Audit queue (Redis-backed async audit log writing)                                        |
| `security/`   | Redis-backed auth security store (login rate limiting, lockout)                           |
| `startup/`    | Server startup services (admin identity, permission seeding, role seeding, htshadow sync) |

## For AI Agents

### Working In This Directory

- Routes use `@hono/standard-validator` for request validation with Zod schemas
- Auth middleware extracts JWT → sets `c.var.user` context
- Permission middleware checks `c.var.user` against required permissions
- Audit trail middleware auto-logs HTTP requests to the audit queue
- Route handlers return via `responses.ts` helpers (ok, created, noContent, etc.)

### Common Patterns

- Each domain module has its own route file(s) in `routes/`
- Validators in `validators/` mirror route structure
- Routes receive use cases from bootstrap module factories
- OpenAPI metadata via `hono-openapi` decorators

<!-- MANUAL: -->
