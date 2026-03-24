<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-24 -->

# modules

## Purpose

Per-domain module factory functions. Each module wires dependencies (repositories, config) into use cases and route handlers for one feature area. Called from `container.ts` to assemble the full application.

## Key Files

| File                 | Description                                         |
| -------------------- | --------------------------------------------------- |
| `ai.ts`              | AI chat and credential wiring                       |
| `audit.ts`           | Audit log query and export wiring                   |
| `auth.ts`            | Authentication, session, invitation, profile wiring |
| `content.ts`         | Content CRUD and file management wiring             |
| `display-runtime.ts` | Display-facing runtime API wiring                   |
| `displays.ts`        | Staff-facing display management wiring              |
| `playlists.ts`       | Playlist management wiring                          |
| `rbac.ts`            | User, role, permission management wiring            |
| `schedules.ts`       | Schedule management wiring                          |
| `index.ts`           | Barrel export of all module factory functions       |

## For AI Agents

### Working In This Directory

- Each module exports a `create*HttpModule()` factory function
- Factory takes: config values + repository instances -> returns use cases + router
- Adding a new domain feature: create module here, wire in `container.ts`, mount in `index.ts`
- Module factories are the ONLY place where use cases are instantiated

<!-- MANUAL: -->
