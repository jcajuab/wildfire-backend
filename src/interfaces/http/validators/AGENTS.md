<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-19 -->

# validators

## Purpose

Zod request validation schemas for HTTP routes. Each file defines schemas for one domain module's API endpoints (query params, path params, request bodies).

## Key Files

| File                     | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `ai.schema.ts`           | AI chat and credential request schemas                       |
| `audit.schema.ts`        | Audit log query and export request schemas                   |
| `auth.schema.ts`         | Login, invitation, password, profile request schemas         |
| `content.schema.ts`      | Content CRUD and file upload schemas                         |
| `displays.schema.ts`     | Display management and registration schemas                  |
| `jwt.schema.ts`          | JWT token payload schema                                     |
| `playlists.schema.ts`    | Playlist and playlist item schemas                           |
| `rbac.schema.ts`         | User, role, permission management schemas                    |
| `schedules.schema.ts`    | Schedule CRUD schemas                                        |
| `standard-validator.ts`  | Custom validator integration with `@hono/standard-validator` |
| `validation-typing.d.ts` | Validator type augmentations                                 |

## For AI Agents

### Working In This Directory

- Schemas validate request input — they are NOT domain entities
- Each schema file exports named schemas used by route handlers via `sValidator()`
- Keep schemas in sync with route handler expectations and use case inputs

<!-- MANUAL: -->
