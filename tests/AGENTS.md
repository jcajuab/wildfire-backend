<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-24 -->

# tests

## Purpose

Test suites organized by architecture layer. Uses Bun's built-in test runner (`bun:test`). Unit tests run without external services; integration tests require MySQL, Redis, and MinIO.

## Subdirectories

| Directory                     | Purpose                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `application/`                | Use-case unit tests with mocked repositories                 |
| `application/ai/`             | AI-specific tests (chat, credentials, tool executor, tiptap) |
| `application/audit/`          | Audit log use-case tests (export, list, record)              |
| `domain/`                     | Domain entity and value object tests (pure logic)            |
| `infrastructure/`             | Repository and adapter tests (integration tests use real DB) |
| `interfaces/`                 | HTTP route tests using Hono's `app.request()` test helper    |
| `interfaces/http/middleware/` | Middleware-specific tests (permissions)                      |
| `architecture/`               | Architectural boundary enforcement tests                     |
| `helpers/`                    | Shared test utilities (env preload, in-memory stores)        |
| `fixtures/`                   | Test fixture files (e.g., `example_htshadow`)                |
| `scripts/`                    | Script tests (e.g., `db/drop-all-tables.test.ts`)            |

## Key Files

| File          | Description                                            |
| ------------- | ------------------------------------------------------ |
| `env.test.ts` | Unit tests for `parseCorsOrigins` env utility function |

## For AI Agents

## Test environment setup

- `bunfig.toml` preloads `tests/helpers/preload-env.ts` before any test file runs.
- The preload sets safe defaults for every required env var (including a valid 32+ char `JWT_SECRET`).
- Integration tests (`RUN_INTEGRATION=true`) may call `setTestEnv` from `tests/helpers/env.ts` to override specific values (MySQL host/port, etc.) after the preload has run.
- Tests should NEVER call `setTestEnv` to override a preload default unless they genuinely need a different value for that specific test.

### Working In This Directory

- Run all tests: `bun run test`
- Integration tests: `RUN_INTEGRATION=true bun test tests/infrastructure`
- Test preload file `helpers/preload-env.ts` sets default env vars (LOG_LEVEL=silent, JWT_SECRET, etc.)
- Use `app.request()` pattern for HTTP route tests (no real server needed)
- Mock repositories by implementing port interfaces inline
- `helpers/in-memory-auth-security.store.ts` provides test double for auth security

### Common Patterns

- Each test file mirrors the source file it tests
- Route tests create a mini Hono app with mocked dependencies
- JWT tokens are issued with `JwtTokenIssuer` using test secret
- Permission testing uses `authorizationRepository.findPermissionsForUser` mock

<!-- MANUAL: -->
