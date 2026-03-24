<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-24 -->

# domain

## Purpose

Pure domain entities, value objects, and business rules. Zero external dependencies — no framework imports, no database, no I/O. This is the innermost layer of the Clean Architecture.

## Subdirectories

| Directory    | Purpose                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------- |
| `content/`   | Content entity (types: TEXT, FLASH, IMAGE, VIDEO, PDF), text-content model, and checksums |
| `playlists/` | Playlist entity with item ordering and duration rules                                     |
| `rbac/`      | Permission value object, permission types, canonical permissions, system role templates   |
| `schedules/` | Schedule entity with time window and kind (PLAYLIST, FLASH) rules                         |

## For AI Agents

### Working In This Directory

- Domain code must be pure — no imports from application, infrastructure, or interfaces
- Entities use factory functions and validation, not ORM decorators
- Changes here affect all layers above — test thoroughly
- Domain tests are in `tests/domain/`
- Note: display entities are not in the domain layer; display logic resides in application use-cases and infrastructure

### Common Patterns

- Entities define their own validation rules (e.g., `Schedule.validateTimeWindow()`)
- Value objects are immutable (e.g., `Permission.parse()`)
- Canonical lists (permissions, role templates) are defined as constants
- `content/text-content.ts` defines structured text content (TipTap format)
- `rbac/permission-types.ts` defines TypeScript types for the permission system

<!-- MANUAL: -->
