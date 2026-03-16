<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-16 -->

# ports

## Purpose

TypeScript interfaces (types) defining contracts between application use cases and infrastructure implementations. Each file defines repository or service interfaces for one domain module. Infrastructure adapters must implement these interfaces exactly.

## Key Files

| File                              | Description                                                      |
| --------------------------------- | ---------------------------------------------------------------- |
| `ai.ts`                           | AI credential and pending action store interfaces                |
| `audit.ts`                        | Audit log repository interface                                   |
| `auth.ts`                         | Auth session, invitation, password, and identity sync interfaces |
| `content.ts`                      | Content repository and storage interfaces                        |
| `content-jobs.ts`                 | Content ingestion job queue interface                            |
| `displays.ts`                     | Display repository interface                                     |
| `display-auth.ts`                 | Display authentication nonce and key interfaces                  |
| `display-pairing.ts`              | Display pairing code and session interfaces                      |
| `display-registration-attempt.ts` | Registration attempt store interface                             |
| `display-stream-events.ts`        | Display SSE event emitter interface                              |
| `notifications.ts`                | Notification service interface                                   |
| `observability.ts`                | Logger interface                                                 |
| `playlists.ts`                    | Playlist repository interface                                    |
| `rbac.ts`                         | User, role, permission, and authorization repository interfaces  |
| `runtime-controls.ts`             | Runtime control repository interface (emergency mode)            |
| `schedules.ts`                    | Schedule repository interface                                    |

## For AI Agents

### Working In This Directory

- Ports are pure TypeScript types — no implementations, no imports from infrastructure
- When adding a new repository method, update the port first, then implement in infrastructure
- Port changes require updating all implementations and potentially test mocks

<!-- MANUAL: -->
