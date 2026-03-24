<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-24 -->

# interfaces

## Purpose

HTTP interface layer. Contains Hono routes, middleware, request/response validators, audit queue, security stores, startup services, and HTTP utilities. This is the outermost application layer that handles HTTP concerns and delegates to use cases.

## Subdirectories

| Directory | Purpose                                      |
| --------- | -------------------------------------------- |
| `http/`   | All HTTP-related code (see `http/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- Routes receive validated input via Zod schemas in `validators/`
- Middleware handles auth (JWT), permissions, CSRF, audit trail, observability
- Routes delegate to use cases — no business logic in route handlers
- Response helpers in `responses.ts` ensure consistent API shape
- Startup services handle initial data seeding and identity sync

<!-- MANUAL: -->
