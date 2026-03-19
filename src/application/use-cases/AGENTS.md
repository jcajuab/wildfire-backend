<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-19 -->

# use-cases

## Purpose

Business operations organized by domain module. Each use case is a single-responsibility class that orchestrates domain logic and repository calls. Use cases receive dependencies via constructor injection.

## Subdirectories

| Directory    | Purpose                                                                            |
| ------------ | ---------------------------------------------------------------------------------- |
| `ai/`        | AI chat, tool execution, credential management, system prompt (see `ai/AGENTS.md`) |
| `audit/`     | Audit log listing, export (CSV), and recording                                     |
| `auth/`      | Authentication, invitation, session, password, profile, avatar                     |
| `content/`   | Content CRUD, file upload/replace, download URLs, PDF crop, flash content          |
| `displays/`  | Display CRUD, registration, pairing, heartbeat, manifest, emergency, snapshots     |
| `playlists/` | Playlist CRUD, item management, reordering, duration estimation                    |
| `rbac/`      | User/role CRUD, permission management, role assignment                             |
| `schedules/` | Schedule CRUD, active schedule resolution, merged playlists                        |
| `shared/`    | Cross-cutting utilities (pagination, duration calculations)                        |
| `users/`     | Admin-specific user operations (reset password, ban)                               |

## For AI Agents

### Working In This Directory

- Each use case has a single `execute()` method
- Use cases depend on ports (interfaces), never on concrete infrastructure
- Each module has an `index.ts` barrel export — update when adding new use cases
- Error handling: throw application errors (NotFound, Forbidden, Validation), not HTTP errors

### Common Patterns

- Constructor receives a `deps` object with typed repository/service dependencies
- Use cases validate business rules, delegate data access to repositories
- View/DTO files (`*-view.ts`) define response shapes separate from domain entities

<!-- MANUAL: -->
