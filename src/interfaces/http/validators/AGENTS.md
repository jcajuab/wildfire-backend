<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-24 -->

# validators

## Purpose

Zod request validation schemas for HTTP routes. Each file defines schemas for one domain module's API endpoints (query params, path params, request bodies).

## Key Files

| File                     | Description                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `ai.schema.ts`           | AI chat and credential request schemas                                                |
| `audit.schema.ts`        | Audit log query and export request schemas                                            |
| `auth.schema.ts`         | Login, invitation, password, profile request schemas                                  |
| `content.schema.ts`      | Content CRUD and file upload schemas                                                  |
| `displays.schema.ts`     | Display management and registration schemas                                           |
| `jwt.schema.ts`          | JWT token payload schema                                                              |
| `playlists.schema.ts`    | Playlist and playlist item schemas                                                    |
| `rbac.schema.ts`         | User, role, permission management schemas                                             |
| `schedules.schema.ts`    | Schedule CRUD schemas                                                                 |
| `standard-validator.ts`  | Hono-openapi validator wrappers that adapt validation failures to API error responses |
| `validation-typing.d.ts` | Ambient type augmentations for `HonoRequest.valid<T>()` and `hono-openapi` generics   |

## For AI Agents

### Working In This Directory

- Schemas validate request input — they are NOT domain entities
- Each schema file exports named schemas used by route handlers via the `validateJson` / `validateForm` / `validateQuery` / `validateParams` wrappers in `standard-validator.ts`
- Keep schemas in sync with route handler expectations and use case inputs

<!-- MANUAL: -->
