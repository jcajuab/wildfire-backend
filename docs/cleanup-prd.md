# Backend Cleanup PRD

Single source of truth for a 27-finding backend cleanup, executed as seven
sequential ralph phases. Each phase is a standalone PR. No source code is
modified by this document.

---

## 1. Purpose & Constraints

### Purpose

Address all 27 audit findings (11 Major, 16 Minor) against
`/home/jcajuab/Codebase/wildfire/backend` while preserving every existing
behavior. Each phase is ordered by risk tier so the low-risk deletes land
first and the highest-blast-radius work (Redis modernization) lands only
after all surrounding code is tidy.

### Constraints (from `CLAUDE.md`)

- Conventional commits only (`refactor(scope): ...`, `chore(deps): ...`).
- No `Co-authored-by` trailers.
- Preserve existing business logic. No feature work, no architectural
  redesign, no new abstractions, no speculative extensibility.
- Prefer deletion and collapsing over adding helpers. Inline trivial
  wrappers rather than renaming them.
- Remove dead code, duplicated logic, stale compatibility shims, and
  meaningless comments as they are encountered inside a phase's scope.
- Keep files focused and modular. Use `ai-slop-cleaner` judgement on any
  code being touched.

### Verification gate for every phase

Each phase PR must pass all of the following locally and in CI before
merge:

- `bun run check` (Biome lint + format, clean)
- `bun run typecheck` (tsc --noEmit, zero errors)
- `bun run test` (all unit and architecture tests green)
- `bun run build` (compile succeeds for server + both workers)

Phase 5 additionally requires:

- `bun run test:integration` (MySQL + Redis + MinIO round-trip tests green)

No phase may be merged with skipped, deleted, or weakened tests. Tests
may be _added_ to cover the refactor, never _removed_ to hide regressions.

---

## 2. Phase Matrix

| Phase | Title                                          | Findings                       | Risk   | Tier   |
| ----- | ---------------------------------------------- | ------------------------------ | ------ | ------ |
| 1     | Delete-only, zero risk                         | M1, m5, m6, M11, m1            | low    | Sonnet |
| 2     | Drop dep and validator swap                    | M2, m7                         | low    | Sonnet |
| 3     | Merge over-split files and relocate enrichers  | M5, M6, m2, m4 (partial)       | medium | Sonnet |
| 4     | Pagination normalization and fallback deletion | M7 then M8                     | medium | Opus   |
| 5     | Redis modernization                            | M3, M4, m3, m10                | high   | Opus   |
| 6     | Worker, singleton, and misc tidy               | M9, M10, m8, m9, m14, m15, m16 | medium | Sonnet |
| 7     | Tests and env cleanup                          | m12, m13, m11                  | low    | Haiku  |

Dependency graph (top-to-bottom must hold across merges):

```
Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6 -> Phase 7
```

No phase may be started until the previous phase is merged to `main` and
CI is green.

---

## 3. Per-Phase Entries

### Phase 1 - Delete-only, zero risk

**scope**

- M1 Delete `src/interfaces/http/validators/validation-typing.d.ts`
  (dead duplicate of `standard-validator.ts`).
- m5 Remove `flushNow()` from the `AuditLogQueue` interface at
  `src/interfaces/http/audit/audit-queue.ts` and its no-op
  implementation in `src/interfaces/http/audit/redis-audit-queue.ts`.
- m6 Delete the `ReadableStream` and async-iterable fallback branches
  in `src/infrastructure/storage/s3-content.storage.ts` (keep the
  `Uint8Array` check and `transformToByteArray()` path only).
- M11 Collapse Redis string-coercion helpers:
  `src/infrastructure/redis/hashes.ts`,
  `src/infrastructure/redis/utils.ts`,
  `src/infrastructure/redis/evalsha-script.ts`. Keep one canonical
  helper exported from `redis/utils.ts` and update the other two
  call sites.
- m1 Inline `registerContentReadRoutes` + `registerContentWriteRoutes`
  calls from `src/interfaces/http/routes/content/crud.route.ts`
  directly into `src/interfaces/http/routes/content/index.ts`, then
  delete `crud.route.ts`.

**depends_on** none

**acceptance_checks**

- `src/interfaces/http/validators/validation-typing.d.ts` does not exist.
- `src/interfaces/http/routes/content/crud.route.ts` does not exist.
- Grep for `flushNow` in `src/` returns zero hits.
- Grep for `toScriptString` and `toStringValue` in `src/` each return
  zero hits.
- S3 download method contains at most 2 branches: `Uint8Array` instance
  check and `transformToByteArray` call.
- `bun run check && bun run typecheck && bun run test && bun run build`
  all exit 0.
- Net deleted line count is at least 120 (measured by
  `git diff --shortstat main..HEAD`).

**out_of_scope**

- Do not touch `@hono/standard-validator` imports yet (Phase 2).
- Do not merge or rename any remaining route files (Phase 3).
- Do not touch any Redis `sendCommand` call sites (Phase 5).
- Do not rewrite the S3 download method body beyond removing the two
  dead branches.

**rollback** Revert the phase merge commit; no data or schema changes.

**suggested_ralph_command**

```
/oh-my-claudecode:ralph --critic=architect Work exclusively on Phase 1
of /home/jcajuab/Codebase/wildfire/backend/docs/cleanup-prd.md. Do not
touch any finding outside Phase 1. After all Phase 1 acceptance checks
pass and reviewer approves, stop - do not advance to Phase 2. Follow
CLAUDE.md. Use conventional commits. No Co-authored-by lines.
```

---

### Phase 2 - Drop dep and validator swap

**scope**

- M2 Replace `sValidator("form", schema, validationHook)` with
  `validator("form", schema, validationHook)` in
  `src/interfaces/http/validators/standard-validator.ts`. Remove
  `@hono/standard-validator` from `package.json` and `bun.lock`.
  Remove the associated `as any as any` double-cast on the same
  line.
- m7 Tighten `AI_TOOLS` typing in
  `src/application/use-cases/ai/ai-tool-registry.ts` so that
  `src/infrastructure/ai/vercel-ai-adapter.ts` no longer needs
  `inputSchema: toolDef.inputSchema as any`.

**depends_on** Phase 1

**acceptance_checks**

- Grep for `sValidator` in `src/` returns zero hits.
- Grep for `@hono/standard-validator` across the whole repo
  (excluding `bun.lock` match only, which must be gone) returns zero
  hits in `package.json` and `src/`.
- `bun.lock` no longer contains `@hono/standard-validator`.
- `src/infrastructure/ai/vercel-ai-adapter.ts` contains no `as any`
  casts.
- `bun run check && bun run typecheck && bun run test && bun run build`
  all exit 0.
- All existing multipart/form-data routes (content upload, avatar
  upload) still round-trip validation in their unit tests.

**out_of_scope**

- Do not touch other validator helpers (`validateJson`, `validateQuery`,
  `validateParams`) - they already use `hono-openapi`'s `validator`.
- Do not reshape the tool registry beyond type tightening.
- Do not change any AI SDK call shape.

**rollback** Revert the phase merge commit. Dependency re-added via
`bun add @hono/standard-validator@<previous-version>`.

**suggested_ralph_command**

```
/oh-my-claudecode:ralph --critic=architect Work exclusively on Phase 2
of /home/jcajuab/Codebase/wildfire/backend/docs/cleanup-prd.md. Do not
touch any finding outside Phase 2. After all Phase 2 acceptance checks
pass and reviewer approves, stop - do not advance to Phase 3. Follow
CLAUDE.md. Use conventional commits. No Co-authored-by lines.
```

---

### Phase 3 - Merge over-split files and relocate enrichers

**scope**

- M5 Merge `roles-read.route.ts`, `roles-write.route.ts`,
  `roles-bootstrap.route.ts`, and `role-memberships.route.ts` into
  one `roles.route.ts` (delete the existing empty
  `roles.route.ts` wrapper first, then rename the consolidated
  file). Apply the same collapse to user routes:
  `users-resource.route.ts`, `user-actions.route.ts`,
  `user-memberships.route.ts` into `users.route.ts` (again,
  delete the wrapper first). Update
  `src/interfaces/http/routes/rbac/index.ts` imports accordingly.
  Also move enrichers `maybeEnrichUserForResponse`,
  `maybeEnrichUsersForResponse`, `addRoleSummariesToUsers` out of
  `src/interfaces/http/routes/rbac/shared.ts` into
  `src/interfaces/http/lib/user-response-enricher.ts`. Shared.ts
  keeps only types and DI tuples.
- M6 Consolidate the four htshadow files
  (`htshadow-file-watcher.service.ts`,
  `htshadow-file.adapter.ts`, `htshadow-resync.service.ts`,
  `htshadow-user-importer.service.ts`) into a single
  `src/interfaces/http/startup/htshadow-sync.service.ts` with
  clearly labelled phases (watch, parse, import, resync). Split
  `admin-identity-manager.service.ts` into `admin-role-seeder.ts`
  and `admin-user-bootstrapper.ts`. Merge
  `permission-seeder.service.ts` and `system-role-seeder.service.ts`
  into a single `rbac-seeders.service.ts`. Leave
  `auth-identity.sync.ts` and `startup-orchestration.helpers.ts`
  untouched. Update `src/bootstrap/http/index.ts` imports.
- m2 Inline `setAuthSessionCookie` from
  `src/interfaces/http/lib/auth-cookie.ts` into its 2 call sites;
  move the shared cookie option bag to
  `src/interfaces/http/lib/constants.ts`. Delete
  `auth-cookie.ts`.
- m4 In `src/interfaces/http/responses.ts` delete the
  single-line wrapper `toApiResponse` (replace call sites with
  `c.json({ data: result })`). Keep `toApiListResponse`
  (non-trivial) and the rate-limit-header helpers. Keep the 7
  error helpers as a group but collapse their bodies through a
  single internal `errorResponse(c, status, code, message,
    details)` helper to remove the per-helper duplication.

**depends_on** Phase 2

**acceptance_checks**

- Files deleted: `routes/rbac/roles-read.route.ts`,
  `routes/rbac/roles-write.route.ts`,
  `routes/rbac/roles-bootstrap.route.ts`,
  `routes/rbac/role-memberships.route.ts`,
  `routes/rbac/users-resource.route.ts`,
  `routes/rbac/user-actions.route.ts`,
  `routes/rbac/user-memberships.route.ts`,
  `startup/htshadow-file-watcher.service.ts`,
  `startup/htshadow-file.adapter.ts`,
  `startup/htshadow-resync.service.ts`,
  `startup/htshadow-user-importer.service.ts`,
  `startup/admin-identity-manager.service.ts`,
  `startup/permission-seeder.service.ts`,
  `startup/system-role-seeder.service.ts`,
  `lib/auth-cookie.ts`.
- New files exist: `startup/htshadow-sync.service.ts`,
  `startup/admin-role-seeder.ts`,
  `startup/admin-user-bootstrapper.ts`,
  `startup/rbac-seeders.service.ts`,
  `lib/user-response-enricher.ts`.
- `src/interfaces/http/routes/rbac/shared.ts` exports no functions
  whose name starts with `maybeEnrich` or `addRoleSummaries`.
- Grep for `toApiResponse(` returns zero hits in `src/`.
- All HTTP route tests in `tests/interfaces/http/` pass without
  modification (except for import-path updates).
- `bun run check && bun run typecheck && bun run test && bun run build`
  all exit 0.
- File count under `src/interfaces/http/startup/` decreases by at
  least 3; file count under `src/interfaces/http/routes/rbac/`
  decreases by at least 5.

**out_of_scope**

- Do not change any permission, role, seeder, or htshadow behavior.
- Do not change any JWT, session cookie, or CSRF behavior.
- Do not touch `auth-identity.sync.ts`.
- Do not change the public response envelope shape.

**rollback** Revert the phase merge commit.

**suggested_ralph_command**

```
/oh-my-claudecode:ralph --critic=architect Work exclusively on Phase 3
of /home/jcajuab/Codebase/wildfire/backend/docs/cleanup-prd.md. Do not
touch any finding outside Phase 3. After all Phase 3 acceptance checks
pass and reviewer approves, stop - do not advance to Phase 4. Follow
CLAUDE.md. Use conventional commits. No Co-authored-by lines.
```

---

### Phase 4 - Pagination normalization and fallback deletion

**scope**

- M7 Normalize all repository pagination to `{ offset, limit }`.
  Change `src/application/ports/displays.ts` from
  `{ page, pageSize }` to `{ offset, limit }`. Update the
  implementing repositories:
  `src/infrastructure/db/repositories/display.repo.ts` (and any
  display-groups repo that shares the contract). Update the
  consuming use cases under
  `src/application/use-cases/displays/` and any route handlers in
  `src/interfaces/http/routes/displays/`. If external HTTP query
  params still accept `page`/`pageSize`, translate them to
  `{ offset, limit }` at the route boundary - public API contract
  stays identical.
- M8 After M7 is in place, delete the owner-fallback branches in
  `src/application/use-cases/playlists/shared.ts`,
  `src/application/use-cases/schedules/shared.ts`,
  `src/application/use-cases/displays/shared.ts`, and
  `src/application/use-cases/rbac/shared.ts`. Any
  `if (ownerId && repository.xxxForOwner) { ... } else { ... }`
  branch whose reason for existence was the pagination mismatch
  is removed; the use-case calls the repository method directly.

**depends_on** Phase 3

**acceptance_checks**

- Grep for `pageSize` in `src/application/ports/` returns zero hits.
- Grep for `pageSize` across the rest of `src/` returns hits only at
  the HTTP route boundary (translating public query params).
- Grep for `ForOwner` in the four target `shared.ts` files returns
  zero hits.
- The four target `shared.ts` files each shrink by at least 30 net
  lines.
- All display list routes still return the same JSON envelope shape
  (verified by `tests/interfaces/http/displays.route.test.ts`).
- `bun run check && bun run typecheck && bun run test && bun run build`
  all exit 0.
- Domain tests under `tests/application/` pass without modification
  (except for pagination-shape updates to mocks).

**out_of_scope**

- Do not introduce a new pagination helper module. Inline the
  translation.
- Do not change the public HTTP contract.
- Do not touch Redis, worker, or AI code paths.

**rollback** Revert the phase merge commit.

**suggested_ralph_command**

```
/oh-my-claudecode:ralph --critic=architect Work exclusively on Phase 4
of /home/jcajuab/Codebase/wildfire/backend/docs/cleanup-prd.md. Do not
touch any finding outside Phase 4. After all Phase 4 acceptance checks
pass and reviewer approves, stop - do not advance to Phase 5. Follow
CLAUDE.md. Use conventional commits. No Co-authored-by lines.
```

---

### Phase 5 - Redis modernization

**scope**

- M3 Replace raw `sendCommand(["SET", ...])`, `["GET", ...]`,
  `["MGET", ...]`, `["PUBLISH", ...]`, `["DEL", ...]`,
  `["EXPIRE", ...]`, etc. with node-redis v5 typed methods
  (`client.set`, `client.get`, `client.mGet`, `client.publish`,
  `client.del`, `client.expire`) across
  `src/infrastructure/redis/**` and all consumers. Delete
  `src/infrastructure/redis/evalsha-script.ts`; replace its two
  script users with `defineScript` registered on
  `createClient({ scripts: { ... } })`. Keep
  `executeRedisCommand` only as a thin wrapper if it still adds
  value (logging); otherwise delete it.
- M4 Migrate `src/infrastructure/displays/display-stream.ts` onto
  `makeRedisEventBus<DisplayStreamEvent>()` from
  `src/infrastructure/redis/event-bus.ts`. Remove the duplicate
  envelope parsing, subscription management, and size-limit
  constants. The public stream API surface (`subscribe`,
  `publish`, etc.) stays identical.
- m3 Delete the local `withTimeout` wrapper inside
  `src/interfaces/http/lib/avatar-url.ts`. Rely on the client-level
  `REDIS_SOCKET_TIMEOUT_MS` + `REDIS_COMMAND_TIMEOUT_MS`.
- m10 Add jitter to the `reconnectStrategy` in
  `src/infrastructure/redis/client.ts` (multiply the exponential
  backoff by a `1 + Math.random() * 0.25` factor). Consolidate
  `src/shared/retry.ts` so the six ad-hoc retry loops in
  `src/bootstrap/workers/**`, `src/infrastructure/content-jobs/**`,
  and `src/interfaces/http/audit/**` call a single
  `retryWithBackoff(fn, opts)` export.

**depends_on** Phase 4

**acceptance_checks**

- Grep for `sendCommand(["` across `src/` returns zero hits (or only
  the necessary in `client.ts` if a thin wrapper remains).
- `src/infrastructure/redis/evalsha-script.ts` does not exist.
- `src/infrastructure/displays/display-stream.ts` imports
  `makeRedisEventBus` and contains no local envelope-parsing code.
- Grep for `withTimeout` in `src/interfaces/http/lib/` returns zero
  hits.
- Grep for literal `Math.min(env.REDIS_RETRY_MAX_DELAY_MS,` in
  `src/shared/retry.ts` or `src/infrastructure/redis/client.ts`
  confirms jitter applied (a `Math.random`-based multiplier is
  present inside the retry math).
- `bun run check && bun run typecheck && bun run test && bun run build`
  all exit 0.
- `bun run test:integration` exits 0 - Redis-backed integration
  tests (streams, event bus, auth session cache) all pass.

**out_of_scope**

- Do not change any public HTTP endpoint shape.
- Do not touch SQL, S3, or AI paths in this phase.
- Do not restructure the worker file layout (Phase 6 handles the
  state-machine consolidation).

**rollback** Revert the phase merge commit. Redis on-disk format and
stream names are unchanged, so no data migration needed.

**suggested_ralph_command**

```
/oh-my-claudecode:ralph --critic=architect Work exclusively on Phase 5
of /home/jcajuab/Codebase/wildfire/backend/docs/cleanup-prd.md. Do not
touch any finding outside Phase 5. After all Phase 5 acceptance checks
pass (including bun run test:integration) and reviewer approves, stop
- do not advance to Phase 6. Follow CLAUDE.md. Use conventional
commits. No Co-authored-by lines.
```

---

### Phase 6 - Worker, singleton, and misc tidy

**scope**

- M9 Consolidate content-ingestion job state transitions into a
  single module (e.g.
  `src/bootstrap/workers/content-ingestion/job-state.ts`). Both
  `entry-processor.ts::markJobAsFailed` and
  `job-processor.ts` success path call into it. The state module
  owns the DB transaction, status update, event publish, and log
  call in one place.
- M10 Inject `authIdentityCache` through the DI container in
  `src/bootstrap/http/container.ts` instead of instantiating a
  module-level singleton in
  `src/bootstrap/http/modules/rbac.ts`. Both the middleware
  (session validation) and the RBAC callbacks
  (`setRolePermissions`, `setUserRoles`) receive the same
  instance. Invalidation is made idempotent (safe to call twice)
  and retries on Redis error.
- m8 Inline `toIsoString` and `toNullableIsoString` from
  `src/infrastructure/db/repositories/utils/date.ts` into the 15+
  repo call sites, then delete the utility file and its parent
  `repositories/utils/` directory if empty.
- m9 Replace the wrapper objects in
  `src/infrastructure/content-jobs/event-publishers.ts` and
  `src/infrastructure/displays/event-publishers.ts` with direct
  function exports (`publishContentJobEvent`, `publishDisplayEvent`,
  `publishLifecycleEvent`, `publishRegistrationAttemptEvent`).
  Update call sites.
- m14 Document the optional-method pattern OR require the method
  everywhere. Apply to
  `src/bootstrap/http/runtime/display-status-reconciler.ts` (the
  `listForReconciliation?` path) and
  `src/bootstrap/http/modules/schedules.ts` (the optional
  `listDisplayGroups` use-case wiring). Choose one approach per
  site, document via JSDoc, and drop the null branch if
  required-everywhere is chosen.
- m15 In `src/infrastructure/db/client.ts`, replace the local
  `DbConnectivityConnection` interface with
  `PoolConnection` imported from `mysql2/promise`.
- m16 Demote the per-event emit log in
  `src/infrastructure/displays/display-stream.ts` from info level
  to debug level; keep subscriber-lifecycle logs at info.

**depends_on** Phase 5

**acceptance_checks**

- `src/infrastructure/db/repositories/utils/date.ts` does not exist;
  grep for `toIsoString` in the repo returns hits only at inline call
  sites or zero hits if the call was replaced with
  `value?.toISOString() ?? null` inline.
- `src/bootstrap/http/modules/rbac.ts` contains no
  `new RedisAuthIdentityCache(` at module top level (the instance is
  constructed exactly once in `container.ts`).
- Grep for `export const contentJobEventPublisher`,
  `displayEventPublisher`, `lifecycleEventPublisher`,
  `registrationAttemptEventPublisher` wrapper-object patterns returns
  zero hits in `src/infrastructure/`.
- `src/infrastructure/db/client.ts` imports `PoolConnection` from
  `mysql2/promise`.
- `src/infrastructure/displays/display-stream.ts` emits the per-event
  log at `logger.debug(...)` not `logger.info(...)`.
- Content-ingestion tests under
  `tests/application/content.use-case.test.ts` and the integration
  stream tests pass.
- `bun run check && bun run typecheck && bun run test && bun run build`
  all exit 0.

**out_of_scope**

- Do not change worker stream names or consumer group names.
- Do not change the DB schema.
- Do not touch the Redis client internals again (Phase 5 closed that
  scope).

**rollback** Revert the phase merge commit.

**suggested_ralph_command**

```
/oh-my-claudecode:ralph --critic=architect Work exclusively on Phase 6
of /home/jcajuab/Codebase/wildfire/backend/docs/cleanup-prd.md. Do not
touch any finding outside Phase 6. After all Phase 6 acceptance checks
pass and reviewer approves, stop - do not advance to Phase 7. Follow
CLAUDE.md. Use conventional commits. No Co-authored-by lines.
```

---

### Phase 7 - Tests and env cleanup

**scope**

- m12 In
  `tests/application/audit/list-audit-logs.use-case.test.ts`,
  `tests/application/audit/export-audit-logs.use-case.test.ts`,
  and any sibling tests using the same pattern, replace
  `throw new Error("unused")` mock stubs with either safe defaults
  (return `null`, `[]`, `undefined`) or explicit
  `expect(mock.method).not.toHaveBeenCalled()` assertions after
  the act phase.
- m13 Standardize on a single test-env setup. Either keep only
  `tests/helpers/preload-env.ts` (Bun preload) and delete
  `tests/helpers/env.ts::setTestEnv`, OR keep only
  `setTestEnv` and drop the preload. Document the choice in
  `tests/AGENTS.md`.
- m11 Inline `toPositiveInteger` from
  `src/application/use-cases/shared/playlist-effective-duration.ts`
  and `clamp` from
  `src/application/use-cases/shared/pagination.ts` at their
  single call sites, then delete the helpers. If a helper ends up
  with zero remaining call sites, also delete the import.

**depends_on** Phase 6

**acceptance_checks**

- Grep for `throw new Error("unused")` under `tests/` returns zero
  hits.
- `tests/AGENTS.md` documents the test-env-setup choice in a
  dedicated section.
- Only one of `preload-env.ts` (registered in `bunfig.toml`) or
  `env.ts::setTestEnv` remains; the other file is deleted.
- Grep for `toPositiveInteger` and `function clamp(` in `src/` each
  return zero hits (inlined or deleted).
- `bun run check && bun run typecheck && bun run test && bun run build`
  all exit 0.

**out_of_scope**

- Do not add new test files.
- Do not rewrite existing test assertions beyond the mock pattern
  change.
- Do not change any `src/` behavior.

**rollback** Revert the phase merge commit.

**suggested_ralph_command**

```
/oh-my-claudecode:ralph --critic=architect Work exclusively on Phase 7
of /home/jcajuab/Codebase/wildfire/backend/docs/cleanup-prd.md. Do not
touch any finding outside Phase 7. After all Phase 7 acceptance checks
pass and reviewer approves, stop - the cleanup is complete. Follow
CLAUDE.md. Use conventional commits. No Co-authored-by lines.
```

---

## 4. Cross-Phase Invariants

Every phase PR must uphold all of these without exception.

- **No behavior changes.** HTTP contracts, Redis key schemes, DB schema,
  and event envelope shapes stay identical. Public response shapes are
  byte-compatible.
- **Domain purity.** `src/domain/**` gains no imports from application,
  infrastructure, or interfaces layers. Add no dependencies to it.
- **No new dependencies.** Only Phase 2 modifies `package.json`, and
  only to _remove_ `@hono/standard-validator`. Any other dep addition
  requires a separate prior approval and is out of scope for this PRD.
- **No new top-level abstractions.** Do not introduce DI containers,
  service locators, strategy factories, or plugin systems. Prefer
  deletion and direct wiring.
- **Tests are never weakened.** Adding tests to cover a refactor is
  allowed and encouraged. Skipping, `.only`-ing, or deleting existing
  tests is forbidden.
- **Conventional commit per phase.** Use `refactor(scope): ...` for
  deletions and merges, `chore(deps): ...` for the dependency drop in
  Phase 2, `test: ...` for Phase 7. One logical change per commit;
  multiple commits per phase are fine but the phase must merge as a
  single PR.
- **No `Co-authored-by` trailers.**
- **ai-slop-cleaner judgement.** While inside a phase's scope, any
  incidental AI slop encountered (dead imports, stale comments, dead
  TODOs on touched lines) is removed opportunistically; do not expand
  scope to hunt for slop in untouched files.

---

## 5. Execution Order & Gating

1. Phases run strictly in order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7.
2. Each phase is a single PR against `main`. No stacked PRs.
3. A phase PR may not be opened until the previous phase PR is merged
   to `main` and CI is green.
4. Phase 5 additionally requires `bun run test:integration` to pass in
   CI (or locally with MySQL + Redis + MinIO running) before merge.
5. After a phase merges, the user pastes the next phase's
   `suggested_ralph_command` from section 3 to start the next ralph
   run. The previous ralph session must be explicitly stopped
   (`/oh-my-claudecode:cancel`) before starting the next.
6. If any phase acceptance check fails twice, pause and open an
   issue. Do not attempt a third retry from a ralph loop.

---

## Appendix - Finding to Phase Map

| Finding | Title                                    | Phase |
| ------- | ---------------------------------------- | ----- |
| M1      | Dead duplicate validation-typing.d.ts    | 1     |
| M2      | Redundant @hono/standard-validator       | 2     |
| M3      | Redis sendCommand wrapper                | 5     |
| M4      | Duplicate Redis pub/sub (display-stream) | 5     |
| M5      | RBAC routes over-split                   | 3     |
| M6      | htshadow + startup services over-split   | 3     |
| M7      | Pagination inconsistency                 | 4     |
| M8      | Duplicate owner-fallback helpers         | 4     |
| M9      | Content-ingestion state duplication      | 6     |
| M10     | authIdentityCache singleton              | 6     |
| M11     | Three string-coercion helpers            | 1     |
| m1      | content/crud.route.ts wrapper            | 1     |
| m2      | auth-cookie.ts trivial wrapper           | 3     |
| m3      | avatar-url.ts double timeout             | 5     |
| m4      | responses.ts error helper duplication    | 3     |
| m5      | RedisAuditQueue.flushNow no-op           | 1     |
| m6      | S3 download dead branches                | 1     |
| m7      | vercel-ai-adapter.ts as any cast         | 2     |
| m8      | date.ts helper module                    | 6     |
| m9      | event-publishers.ts wrapper objects      | 6     |
| m10     | retry loops + reconnect jitter           | 5     |
| m11     | clamp + toPositiveInteger micro-helpers  | 7     |
| m12     | test mock throw("unused") pattern        | 7     |
| m13     | dual test env setup                      | 7     |
| m14     | undocumented optional repo methods       | 6     |
| m15     | db/client.ts PoolConnection retype       | 6     |
| m16     | display-stream info-level emit log       | 6     |

Total: 27 of 27 findings assigned to a phase.
