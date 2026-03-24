<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-24 -->

# http (bootstrap)

## Purpose

HTTP server composition root. Creates the Hono app, wires all dependencies via module factories, configures health checks, and manages background runtime services (display status reconciler).

## Key Files

| File               | Description                                                           |
| ------------------ | --------------------------------------------------------------------- |
| `container.ts`     | Master DI container — creates all repositories, use cases, and routes |
| `index.ts`         | Hono app creation, global middleware, route mounting, exports         |
| `health-checks.ts` | Health check endpoints (liveness, readiness)                          |

## Subdirectories

| Directory  | Purpose                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `modules/` | Per-domain module factories — wire dependencies for each feature area (see `modules/AGENTS.md`) |
| `runtime/` | Background runtime services — `display-status-reconciler.ts` (periodic display status checks)   |

## For AI Agents

### Working In This Directory

- Adding a new feature: create a module factory in `modules/`, wire it in `container.ts`
- Module factories take (config, repositories) -> return { useCases, router }
- `index.ts` is the central app assembly — all routes are mounted here
- `runtime/display-status-reconciler.ts` runs as a background task alongside the HTTP server

<!-- MANUAL: -->
