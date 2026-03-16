<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-16 -->

# bootstrap

## Purpose

Dependency wiring and initialization. Creates concrete instances of repositories and use cases, assembles the Hono app with all routes, and configures worker processes. Acts as the composition root.

## Subdirectories

| Directory  | Purpose                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `http/`    | HTTP server assembly — DI container, route mounting, health checks, modules (see `http/AGENTS.md`) |
| `workers/` | Worker process bootstrap — audit stream, content ingestion pipeline (see `workers/AGENTS.md`)      |

## For AI Agents

### Working In This Directory

- This is the composition root — the only place where concrete implementations are instantiated
- Module files in `http/modules/` wire dependencies for each domain feature
- Adding a new feature requires: define port → implement in infrastructure → create use case → wire in bootstrap module → add route
- `container.ts` creates the top-level DI wiring

### Common Patterns

- Each module factory function takes config + repositories, returns use cases and router
- No runtime DI container — explicit factory function composition

<!-- MANUAL: -->
