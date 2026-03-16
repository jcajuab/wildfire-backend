<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-16 -->

# tests

## Purpose

Test suites organized by architecture layer. Uses Bun's built-in test runner (`bun:test`). Unit tests run without external services; integration tests require MySQL, Redis, and MinIO.

## Subdirectories

| Directory         | Purpose                                                      |
| ----------------- | ------------------------------------------------------------ |
| `application/`    | Use-case unit tests with mocked repositories                 |
| `domain/`         | Domain entity and value object tests (pure logic)            |
| `infrastructure/` | Repository and adapter tests (integration tests use real DB) |
| `interfaces/`     | HTTP route tests using Hono's `app.request()` test helper    |
| `architecture/`   | Architectural boundary enforcement tests                     |
| `helpers/`        | Shared test utilities (env preload, in-memory stores)        |
| `fixtures/`       | Test fixture files                                           |
| `scripts/`        | Script tests                                                 |

## For AI Agents

### Working In This Directory

- Run all tests: `bun run test`
- Integration tests: `RUN_INTEGRATION=true bun test tests/infrastructure`
- Test preload file `helpers/preload-env.ts` sets default env vars (LOG_LEVEL=silent)
- Use `app.request()` pattern for HTTP route tests (no real server needed)
- Mock repositories by implementing port interfaces inline

### Common Patterns

- Each test file mirrors the source file it tests
- Route tests create a mini Hono app with mocked dependencies
- JWT tokens are issued with `JwtTokenIssuer` using test secret
- Permission testing uses `authorizationRepository.findPermissionsForUser` mock

<!-- MANUAL: -->
