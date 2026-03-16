<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-16 -->

# application

## Purpose

Application layer containing use cases (business operations), ports (repository/service interfaces), application-level errors, and reporting logic. Depends only on domain layer. Infrastructure implements the ports defined here.

## Subdirectories

| Directory    | Purpose                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| `use-cases/` | Business operations organized by domain module (see `use-cases/AGENTS.md`)                                      |
| `ports/`     | Repository and service interfaces (TypeScript types) that infrastructure must implement (see `ports/AGENTS.md`) |
| `errors/`    | Application-level error classes (AppError, NotFound, Forbidden, Validation)                                     |
| `reporting/` | Cross-domain reporting logic (content-playlist relationships)                                                   |

## For AI Agents

### Working In This Directory

- Ports define the contract — use cases consume ports, infrastructure implements them
- Use cases are single-responsibility: one class per operation
- Application errors extend `AppError` base class with HTTP-mappable error codes
- Never import infrastructure or interface code here

### Common Patterns

- Use case classes receive dependencies via constructor injection
- Each domain module has an `index.ts` barrel export
- Use cases return domain entities or plain objects, never HTTP responses

<!-- MANUAL: -->
