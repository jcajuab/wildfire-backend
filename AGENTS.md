# AGENTS.md

## Purpose

Defines how AI agents must operate in this backend.

This is a Bun + Hono modular monolith.
Not Next.js.
No frontend assumptions allowed.

---

# PROJECT CONTEXT

Wildfire Backend:

Admin → Upload Content → MinIO (checksum required)
Content → Playlist → Schedule → Device Poll → Manifest

Entities:

- Content
- Playlist
- PlaylistItem
- Schedule
- Display

Stack:

- Runtime: Bun
- HTTP: Hono
- DB: MySQL + Drizzle
- Storage: MinIO
- Auth: JWT
- Validation: Zod
- Testing: Bun test

---

# AGENT OPERATING RULES

When modifying code:

1. Identify architectural layer
2. Confirm dependency direction
3. Write failing test first
4. Implement minimal change
5. Verify no boundary violations
6. Run required commands
7. Re-check architecture

Never:

- Introduce cross-layer imports
- Add framework logic to domain
- Skip test creation
- Modify multiple modules without justification

---

# ARCHITECTURE VALIDATION

## Dependency Direction

No:

- infrastructure inside application/domain
- domain importing application
- use case importing concrete DB

## Use Case Purity

Use cases must:

- Accept injected interfaces
- Not use Drizzle directly
- Not call MinIO directly

## Controller Rules

Controllers must:

- Validate with Zod
- Call a use case
- Map errors consistently
- Avoid business branching logic

---

# SECURITY CHECKS

- JWT middleware on protected routes
- RBAC enforced in use case
- No secrets in logs
- No raw body audit persistence
- Checksums stored for uploads

---

# STORAGE CONSISTENCY

Ensure:

- MinIO object key stored in DB
- Checksum persisted
- No media transformations
- Schedules assign playlists only

---

# TEST ENFORCEMENT

Reject change if:

- Behavior changed without test
- Domain test touches I/O
- Use case not tested with fakes

---

# CODE SMELL DETECTION

Flag if:

- God repository
- Circular dependency
- Repeated error mapping
- Controller exceeds reasonable size
- Mixed domain + infrastructure logic
- Unused exports
- Implicit any
- Side effects in constructors

---

# DELIVERY GATES

Always execute:

bun test
bun run check
bun run build

If any fail → do not proceed.

---

# STRICT AUDIT CHECKLIST

When auditing:

1. Architecture alignment
2. Domain correctness
3. API module boundaries
4. JWT + RBAC enforcement
5. Zod validation
6. Drizzle schema alignment
7. Checksum storage
8. Layer-aligned tests
9. No dead code
