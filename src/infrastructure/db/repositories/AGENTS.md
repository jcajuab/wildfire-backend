<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-16 -->

# repositories

## Purpose

Drizzle ORM repository implementations. Each file implements one or more port interfaces from `application/ports/`, translating domain operations into MySQL queries.

## Key Files

| File                              | Description                                |
| --------------------------------- | ------------------------------------------ |
| `ai-credentials.repo.ts`          | AI provider API key storage (encrypted)    |
| `audit-logs.repo.ts`              | Audit log persistence and querying         |
| `auth-session.repo.ts`            | Redis-backed auth session management       |
| `authorization.repo.ts`           | Permission resolution for users            |
| `content.repo.ts`                 | Content entity CRUD                        |
| `content-job.repo.ts`             | Content ingestion job tracking             |
| `display.repo.ts`                 | Display entity CRUD and status management  |
| `display-auth-nonce.repo.ts`      | Display authentication nonce storage       |
| `display-groups.repo.ts`          | Display group management                   |
| `display-key.repo.ts`             | Display cryptographic key management       |
| `display-pairing-code.repo.ts`    | Display pairing code generation/validation |
| `display-pairing-session.repo.ts` | Display pairing session tracking           |
| `display-preview.repo.ts`         | Display preview image storage              |
| `invitation.repo.ts`              | User invitation management                 |
| `permission.repo.ts`              | Permission CRUD                            |
| `playlist.repo.ts`                | Playlist and playlist item CRUD            |
| `role.repo.ts`                    | Role CRUD                                  |
| `role-permission.repo.ts`         | Role-permission assignment                 |
| `runtime-control.repo.ts`         | Runtime control flags (emergency mode)     |
| `schedule.repo.ts`                | Schedule CRUD and time-window queries      |
| `user.repo.ts`                    | User entity CRUD                           |
| `user-role.repo.ts`               | User-role assignment                       |

## Subdirectories

| Directory | Purpose                              |
| --------- | ------------------------------------ |
| `utils/`  | Database utilities (date formatting) |

## For AI Agents

### Working In This Directory

- Each repository implements the corresponding port interface exactly
- Use Drizzle query builder — avoid raw SQL
- Handle MySQL constraint violations gracefully (unique, foreign key)
- Date conversion between JS Date and MySQL date strings via `utils/date.ts`

<!-- MANUAL: -->
