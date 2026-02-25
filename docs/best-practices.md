# Best Practices Guide

## Table of Contents

1. [TDD with Bun Test Runner](#tdd-with-bun-test-runner)
2. [Clean Architecture + SOLID Principles](#clean-architecture--solid-principles)
3. [Quality Gates (Secondary)](#quality-gates-secondary)
4. [Security & Performance (Secondary)](#security--performance-secondary)
5. [Observability (Secondary)](#observability-secondary)
6. [Checklists](#checklists)

---

## TDD with Bun Test Runner

**TDD is the default** for this codebase. Every behavior change starts with a failing test, then the smallest implementation to pass, then refactor with tests still green.

### Why TDD is the default

- **Correctness first**: tests define expected behavior before implementation
- **Safer refactors**: failing tests catch regressions immediately
- **Clearer design**: test seams encourage small, focused modules

### Red-Green-Refactor loop

1. **Red**: write a failing test that captures the behavior
2. **Green**: implement the smallest change to make it pass
3. **Refactor**: clean up design without changing behavior

### Bun test basics (built-in runner)

Bun ships with a built-in test runner. Use `bun:test` for tests and run them with `bun test`.

```ts
import { describe, expect, test } from "bun:test";

describe("content checksum", () => {
  test("returns a sha-256 hash", () => {
    const checksum = createChecksum("hello");
    expect(checksum).toBeTypeOf("string");
    expect(checksum.length).toBe(64);
  });
});
```

### Async tests

Bun supports async tests. If you use a `done` callback, you must call it to finish the test.

```ts
import { test, expect } from "bun:test";

test("uploads content", (done) => {
  uploadContent("file.png").then((result) => {
    expect(result.status).toBe("ok");
    done();
  });
});
```

### Grouping and parameterized tests

Use `describe` to group tests and `test.each`/`describe.each` for parameterized cases.

```ts
import { describe, expect, test } from "bun:test";

describe.each([
  ["image/png", true],
  ["video/mp4", true],
  ["application/zip", false],
])("content type validation", (mime, allowed) => {
  test(`mime ${mime}`, () => {
    expect(isAllowedMime(mime)).toBe(allowed);
  });
});
```

### Todo and skip tests

- `test.todo("name")` marks tests you plan to implement later
- `bun test --todo` runs todo tests and reports any that unexpectedly pass
- `test.skip("name", () => {})` skips a test

### Running tests

- `bun test` runs the full test suite in a single process
- `bun test <path>` runs a targeted subset

### Test file discovery

The Bun test runner automatically discovers test files using these patterns:

```
*.test.{js|jsx|ts|tsx}
*_test.{js|jsx|ts|tsx}
*.spec.{js|jsx|ts|tsx}
*_spec.{js|jsx|ts|tsx}
```

### TDD structure aligned with Clean Architecture

Keep tests aligned with the architectural layer they validate:

- **Entities / Domain rules**: fast unit tests (no I/O)
- **Use cases (application layer)**: unit tests with faked gateways
- **Interface adapters**: contract tests for repositories/controllers
- **Frameworks & drivers**: integration tests (DB, HTTP, storage)

### Example TDD flow (use case)

```ts
// 1) Write failing test
import { test, expect } from "bun:test";

test("CreatePlaylistUseCase rejects empty name", async () => {
  const useCase = new CreatePlaylistUseCase({ repo: fakeRepo() });
  await expect(useCase.execute({ name: "" })).rejects.toThrow(
    "name is required",
  );
});

// 2) Implement minimal behavior (then refactor later)
```

---

## Clean Architecture + SOLID Principles

### Clean Architecture layers (dependency rule)

Dependencies point **inward**. Outer layers can depend on inner layers, but not the reverse.

1. **Entities**: enterprise rules and core domain models
2. **Use Cases**: application-specific business rules
3. **Interface Adapters**: controllers, presenters, repositories
4. **Frameworks & Drivers**: DB, web server, storage, external APIs

### SOLID, mapped to architecture

#### 1. Single Responsibility Principle (SRP)

- **Entities**: represent one domain concept
- **Use cases**: one user goal
- **Adapters**: one interface or transport concern

#### 2. Open/Closed Principle (OCP)

- Extend behavior by adding new implementations, not changing core use cases
- Example: add a new storage adapter without touching domain logic

#### 3. Liskov Substitution Principle (LSP)

- Any adapter must satisfy the interface contract
- Use cases should not care which repository implementation is used

#### 4. Interface Segregation Principle (ISP)

- Define small, purpose-built interfaces per use case
- Avoid “god” repositories with unrelated methods

#### 5. Dependency Inversion Principle (DIP)

- Use cases depend on interfaces, not concrete DBs or frameworks
- Infrastructure provides implementations at the boundary

### Practical folder boundary guidance

- `domain/` → entities, value objects, domain services
- `application/` → use cases, ports (interfaces)
- `interfaces/` → controllers, request/response mappers
- `infrastructure/` → DB, storage, external clients

### Clean Architecture testing alignment

- **Domain**: pure unit tests (fast, deterministic)
- **Use cases**: use fakes/mocks for ports
- **Adapters**: contract tests ensure correct mapping
- **Infrastructure**: integration tests with real services

---

## Quality Gates (Secondary)

- **PRs require tests** for any behavior change
- **Refactor with tests green** (no refactor before green)
- **Review against architecture** (no framework dependencies inside use cases)
- **Docs updated** when interfaces change
- **Hono docs source of truth**: always query https://hono.dev/llms-full.txt for Hono documentation
- **DRY**: avoid duplication; prefer shared abstractions over copy-paste
- **Architecture boundary check**: run `bun run check:architecture` to block forbidden inward dependency violations
- **Thin routes**: keep route modules focused and split by subresource when handlers grow
- **Route errors**: map use-case errors through shared route error handlers/mappers instead of repeating inline `try/catch` blocks in each route

---

## Security & Performance (Secondary)

### Security

- Validate inputs at the boundary (controller/request layer)
- Keep secrets in environment variables
- Enforce RBAC via use case boundaries

### Performance

- Prefer batch operations in repositories
- Cache only at interface boundaries or infrastructure layer
- Keep domain logic synchronous and side-effect free

---

## Observability (Secondary)

- Add request IDs for every HTTP request and propagate them in logs
- Use structured JSON logs at the interface boundary
- Log error codes and statuses, not secrets or PII
- Keep observability concerns in interface/infrastructure layers
- Include `sessionId` and `fileId` when available to improve traceability across auth/content flows
- Use action naming convention: `<module>.<resource>.<operation>` (example: `rbac.user.update`)
- Set explicit route templates in action metadata (example: `/users/:id`)
- Persist audit events for mutating/security actions with immutable metadata-only records
- Keep audit persistence off the request critical path (queue + background flush)
- Never persist request bodies, passwords, API keys, JWTs, or secret headers in audit data
- Protect audit query routes with explicit RBAC permissions (`audit:read`, `audit:download`)
- If forwarded IP headers are trusted, document deployment assumptions and spoofing risk

### Local Gate Order

Run local gates in this order:

1. `bun test`
2. `bun run check`
3. `bun run build`
