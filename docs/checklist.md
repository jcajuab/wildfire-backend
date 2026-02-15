# Module Progress Checklist

Date: 2026-02-10

Integration test run command: `bun run test:integration`

## Auth

- [x] Domain entities/value objects
- [x] Use cases
- [x] Ports (interfaces)
- [x] Adapters (HTTP routes/controllers)
- [x] Infrastructure (JWT, credentials, password verifier)
- [x] Tests (unit + route)
- [ ] Integration tests (real external auth source)
- [ ] Observability per action (if needed beyond current request logging)

## RBAC

- [x] Domain entities/value objects
- [x] Use cases
- [x] Ports (interfaces)
- [x] Adapters (HTTP routes/controllers)
- [x] Infrastructure (repositories)
- [x] Tests (unit + route)
- [x] Integration tests (DB-backed; via `test:integration`)
- [ ] Observability per action (if needed beyond current request logging)

## Content

- [x] Domain entities/value objects
- [x] Use cases
- [x] Ports (interfaces)
- [x] Adapters (HTTP routes/controllers)
- [x] Infrastructure (DB + S3 storage)
- [x] Tests (unit + route)
- [x] Integration tests (DB + S3; via `test:integration`)
- [ ] Observability per action (if needed beyond current request logging)

## Devices

- [x] Domain entities/value objects
- [x] Use cases
- [x] Ports (interfaces)
- [x] Adapters (HTTP routes/controllers)
- [x] Infrastructure (repositories)
- [x] Tests (unit + route)
- [x] Integration tests (gated)
- [x] Observability per action

## Playlists

- [x] Domain entities/value objects
- [x] Use cases
- [x] Ports (interfaces)
- [x] Adapters (HTTP routes/controllers)
- [x] Infrastructure (repositories)
- [x] Tests (unit + route)
- [x] Integration tests (gated)
- [x] Observability per action

## Schedules

- [x] Domain entities/value objects
- [x] Use cases
- [x] Ports (interfaces)
- [x] Adapters (HTTP routes/controllers)
- [x] Infrastructure (repositories)
- [x] Tests (unit + route)
- [x] Integration tests (gated)
- [x] Observability per action

## Audit

- [x] Domain entities/value objects (N/A; metadata event model at port/use-case level)
- [x] Use cases
- [x] Ports (interfaces)
- [x] Adapters (HTTP routes/controllers + middleware capture)
- [x] Infrastructure (DB repository)
- [x] Tests (unit + route + middleware + queue)
- [x] Integration tests (gated)
- [x] Observability per action
- [x] Export endpoint (`audit:export`) with cap
