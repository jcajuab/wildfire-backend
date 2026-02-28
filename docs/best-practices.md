# Best Practices

## Purpose

This document defines non-negotiable engineering constraints.
If a change violates this document, it is incorrect.

---

# 1. TDD IS MANDATORY

## Rule

No behavior change without a failing test first.

### Required Cycle

1. Write failing test
2. Implement minimal change to pass
3. Refactor with tests green

Never:

- Implement before writing a test
- Refactor while tests are failing
- Add behavior without coverage

---

## Layered Testing Matrix

| Layer          | Test Type     | I/O Allowed   | Speed  |
| -------------- | ------------- | ------------- | ------ |
| Domain         | Unit          | No            | Fast   |
| Use Case       | Unit w/ Fakes | No real I/O   | Fast   |
| Adapters       | Contract      | Mock infra    | Medium |
| Infrastructure | Integration   | Real DB/MinIO | Slow   |

If a test touches DB, HTTP, or MinIO → it is not a domain test.

---

## Test Naming Convention

Format:

`<unit> should <behavior> when <condition>`

Example:

`CreatePlaylistUseCase should reject empty name when name is blank`

---

# 2. CLEAN ARCHITECTURE (STRICT)

## Dependency Rule

Dependencies must point inward.

Allowed:

interfaces → application → domain
infrastructure → application → domain

Forbidden:

domain → application
domain → infrastructure
application → interfaces
application → concrete infrastructure

---

## Layer Responsibilities

### Domain

- Pure business rules
- No framework imports
- No DB/HTTP/Storage/JWT
- Deterministic and side-effect free

### Application (Use Cases)

- Orchestrates domain
- Depends only on interfaces (ports)
- No direct DB or SDK calls

### Interfaces

- HTTP controllers
- Zod validation
- Response mapping
- Error translation

No business logic.

### Infrastructure

- Drizzle repositories
- MinIO clients
- JWT adapter
- External APIs

No business rules.

---

# 3. PORT DESIGN RULES

Each use case defines its own minimal interface.

Bad:
Large “god” repository interfaces.

Good:
Use-case-specific repository contracts.

Interfaces must:

- Be small
- Not leak ORM types
- Contain only required methods

---

# 4. ERROR STRATEGY

Domain:

- Throw domain-specific errors

Application:

- Translate infrastructure errors

Interfaces:

- Map domain errors to HTTP responses

Never expose raw DB errors.

---

# 5. SECURITY RULES

- Validate all inputs at controller boundary (Zod)
- Enforce RBAC inside use case
- Never log secrets
- Store checksums for uploads
- No request body persistence in audit

---

# 6. PERFORMANCE RULES

- Domain must remain synchronous
- Batch repository operations
- No server-side media processing
- No caching inside domain

---

# 7. OBSERVABILITY RULES

Every request must include:

- requestId
- action name (`module.resource.operation`)
- route template

Audit:

- Metadata only
- No secrets
- Async persistence preferred

---

# 8. LOCAL GATE ORDER (MANDATORY)

Before commit:

bun test
bun run check
bun run build

Failure blocks change.

---

# 9. AUTOMATED AUDIT CHECKLIST

Verify:

- No outward dependency violations
- No framework imports in domain/application
- Controllers are thin
- Zod validation at boundary
- Tests for behavior changes
- No dead code
- No duplicate abstractions
- No circular dependencies
