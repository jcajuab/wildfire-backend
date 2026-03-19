<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-19 -->

# src

## Purpose

Application source code organized in Clean Architecture layers. Each layer has strict dependency rules: domain has no dependencies, application depends on domain, infrastructure implements application ports, and interfaces consume application use cases.

## Key Files

| File       | Description                                                           |
| ---------- | --------------------------------------------------------------------- |
| `index.ts` | HTTP server entrypoint — bootstraps app, signal handling, Bun.serve() |
| `env.ts`   | Environment variable schema and validation                            |

## Subdirectories

| Directory         | Purpose                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `domain/`         | Pure domain entities and business rules (see `domain/AGENTS.md`)                            |
| `application/`    | Use cases, ports (interfaces), guards, and application errors (see `application/AGENTS.md`) |
| `infrastructure/` | External system adapters — DB, Redis, S3, AI providers (see `infrastructure/AGENTS.md`)     |
| `interfaces/`     | HTTP routes, middleware, validators (see `interfaces/AGENTS.md`)                            |
| `bootstrap/`      | Dependency wiring and server initialization (see `bootstrap/AGENTS.md`)                     |
| `shared/`         | Cross-cutting utilities (retry logic)                                                       |
| `types/`          | Ambient type declarations for untyped packages                                              |

## For AI Agents

### Working In This Directory

- Use `#/` path alias for all imports (e.g., `#/domain/content/content`)
- Dependency flow: `domain` ← `application` ← `infrastructure` ← `interfaces` ← `bootstrap`
- Never import from a higher layer into a lower layer (e.g., domain must not import from application)

### Common Patterns

- Ports (interfaces) defined in `application/ports/`, implemented in `infrastructure/`
- Use cases are single-responsibility classes in `application/use-cases/`
- Each domain module (content, displays, playlists, schedules, rbac) has consistent structure across all layers

<!-- MANUAL: -->
