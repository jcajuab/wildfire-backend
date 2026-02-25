# Wildfire Backend Overview (Source-of-Truth Spec)

This document is a module-by-module specification of the Wildfire backend, derived from the current code in:

- `src/interfaces/http/index.ts`
- `src/interfaces/http/routes/**`
- `src/interfaces/http/validators/*.ts`
- `src/application/use-cases/**`
- `src/domain/**`
- `src/infrastructure/**`
- `src/env.ts`

Scope: backend API only.

---

## What Wildfire Is

Wildfire is a centralized backend for managing digital signage on a campus:

- Staff users upload media ("content") to object storage.
- Staff users assemble content into playlists (ordered items with durations).
- Staff users schedule playlists onto devices (time windows + days + priority).
- Devices poll the API for the current active schedule and a "manifest" that includes presigned download URLs and checksums.

Key rule: playlists are scheduled (not individual content items).

---

## Architecture (As Implemented)

- Runtime: Bun
- HTTP framework: Hono
- Validation: Zod (via `hono-openapi` + `@hono/standard-validator`)
- Database: MySQL (Drizzle ORM)
- Object storage: MinIO (S3-compatible, AWS SDK S3 client)
- Auth: JWT (HS256) for staff users; shared API key for devices
- API docs: OpenAPI + Scalar (enabled when `NODE_ENV !== "production"`)

Composition root / dependency wiring: `src/interfaces/http/index.ts`

The HTTP layer creates repositories and infrastructure adapters and injects them into routers and use cases.

---

## Conventions

### Base Responses

All error responses use the same JSON shape (`src/interfaces/http/responses.ts`):

```json
{
  "error": {
    "code": "INVALID_REQUEST | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | INTERNAL_ERROR",
    "message": "..."
  }
}
```

Common status codes:

- 400 `INVALID_REQUEST` (failed request validation)
- 401 `UNAUTHORIZED` (invalid or missing auth)
- 403 `FORBIDDEN` (authenticated but not allowed)
- 404 `NOT_FOUND`
- 500 `INTERNAL_ERROR`

All HTTP route examples in this document are relative to the versioned API base path:

- `/api/v1`

### Request Validation

Validation failures return:

- 400 with `{ "error": { "code": "INVALID_REQUEST", "message": "Invalid request" } }`

Validators are defined in `src/interfaces/http/validators/*.ts`.

### Staff Authentication (JWT)

- Header: `Authorization: Bearer <jwt>`
- JWT is HS256-signed with `JWT_SECRET`
- The API reads these JWT claims (`src/interfaces/http/validators/jwt.schema.ts`):

```ts
type JwtPayload = {
  sub: string;
  email?: string;
  iat?: number;
  exp?: number;
  iss?: string;
};
```

### Device Authentication (API Key)

Device endpoints require the shared API key header:

- Header name checked by code: `x-api-key`
- Valid when header value exactly equals `DEVICE_API_KEY`

### Observability (Request Logging)

Global middleware in `src/interfaces/http/index.ts`:

- `requestId()` sets `requestId`
- `auditTrailMiddleware` enqueues selected mutation/security metadata for async persistence to `audit_events`
- `requestLogger` logs on completion

Background worker lifecycle:

- Audit persistence uses an in-memory queue (`InMemoryAuditQueue`) and flush timer.
- On process shutdown (`SIGINT`, `SIGTERM`), `stopHttpBackgroundWorkers()` drains in-flight audit flushes before exit.

Log payload always includes:

- `requestId`, `method`, `path`, `status`, `durationMs`

It may also include:

- `action` (set explicitly by routes using `setAction(...)`)
- `route` (template if available, else actual path)
- `actorId`, `actorType` (`"user"` or `"device"`)
- `resourceId`, `resourceType`
- `sessionId` (derived from JWT claims when available)
- `fileId` (for content/file-oriented requests when available)

Error handling (`app.onError`) logs:

- `logger.error(...)` for status >= 500
- `logger.warn(...)` for status < 500

Audit records are metadata-only and do not include request bodies, credentials, JWTs, or API keys.
Client IP currently trusts `x-forwarded-for` / `x-real-ip` headers as provided by upstream.

---

## Core Entities (Data Shapes)

These shapes are the API view shapes (what routes return), backed by the repository records.

### Content

Returned shape (`src/interfaces/http/validators/content.schema.ts`):

```ts
type Content = {
  id: string;
  title: string;
  type: "IMAGE" | "VIDEO" | "PDF";
  mimeType: string;
  fileSize: number;
  checksum: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: string;
  createdBy: { id: string; name: string };
};
```

### Playlist / Playlist Item

```ts
type Playlist = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string | null };
};

type PlaylistItem = {
  id: string;
  sequence: number;
  duration: number;
  content: {
    id: string;
    title: string;
    type: "IMAGE" | "VIDEO" | "PDF";
    checksum: string;
  };
};

type PlaylistWithItems = Playlist & { items: PlaylistItem[] };
```

### Schedule

```ts
type Schedule = {
  id: string;
  name: string;
  playlistId: string;
  deviceId: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  playlist: { id: string; name: string | null };
  device: { id: string; name: string | null };
};
```

### Device

```ts
type Device = {
  id: string;
  identifier: string;
  name: string;
  location: string | null;
  createdAt: string;
  updatedAt: string;
};
```

### RBAC: User / Role / Permission

```ts
type User = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  timezone?: string | null;
  avatarKey?: string | null;
};
type Role = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
};
type Permission = { id: string; resource: string; action: string };
```

---

## System Workflows

### 1) Staff Content Publishing Workflow

1. Staff authenticates via `POST /auth/login` and receives a JWT.
2. Staff uploads media via `POST /content` (multipart form).
3. Staff creates a playlist via `POST /playlists`.
4. Staff adds playlist items via `POST /playlists/:id/items` (references existing content).
5. Staff creates a schedule via `POST /schedules` (assign playlist to a device within time window/days/priority).

### 2) Device Playback Sync Workflow

1. Device registers (or updates) itself via `POST /displays` with `x-api-key`.
2. Device fetches active schedule via `GET /displays/:id/active-schedule` (optional; returns `Schedule | null`).
3. Device fetches manifest via `GET /displays/:id/manifest`.
4. Device compares `playlistVersion` and/or content `checksum` values to decide what to download.
5. Device downloads content via the manifest `downloadUrl` fields.

### 3) RBAC Administration Workflow

1. Admin (with RBAC permissions) manages roles via `/roles...`.
2. Admin manages permissions assignments via `/roles/:id/permissions`.
3. Admin manages users via `/users...` and assigns roles via `/users/:id/roles`.

---

## Modules

## Health

### GET `/`

Public health check.

Response 200:

```json
{ "status": "ok" }
```

---

## Audit Module

Router: `src/interfaces/http/routes/audit.route.ts` mounted at `/audit`.

### Purpose

Provide traceable "who did what and when" history for mutation/security actions.

### Endpoint

#### GET `/audit/events` (JWT + `audit:read`)

Returns paginated audit events.

Query parameters:

- `page`, `pageSize`
- `from`, `to` (ISO datetime range)
- `actorId`, `actorType`
- `action`
- `resourceType`, `resourceId`
- `status`
- `requestId`

Response 200:

```json
{
  "items": [
    {
      "id": "<uuid>",
      "occurredAt": "2026-02-12T20:00:00.000Z",
      "requestId": "req-...",
      "action": "rbac.user.update",
      "route": "/users/:id",
      "method": "PATCH",
      "path": "/users/...",
      "status": 200,
      "actorId": "<uuid>",
      "actorType": "user",
      "resourceId": "<uuid>",
      "resourceType": "user",
      "ipAddress": "127.0.0.1",
      "userAgent": "Mozilla/5.0",
      "metadataJson": null
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 1
}
```

#### GET `/audit/events/export` (JWT + `audit:download`)

Returns `text/csv` attachment with the same filter fields as `/audit/events` (excluding pagination).

Safety behavior:

- export is capped by `AUDIT_EXPORT_MAX_ROWS` (default 100000)
- when matched rows exceed cap, API returns 400 (`INVALID_REQUEST`)
- export rows are fetched in chunks (not loaded all at once) before CSV write
- invalid normalized filters (for example `from > to`) return 400 (`INVALID_REQUEST`)

---

## Auth Module

Router: `src/interfaces/http/routes/auth.route.ts` mounted at `/auth`.

### Purpose

Authenticate staff users and issue JWTs.

### Credential Source

- Password hashes are loaded from the htshadow file at `HTSHADOW_PATH`.
- File format is line-based: `email:hash`
- Hash verification uses bcrypt, with `$2y$` normalized to `$2b$`.

### Token TTL

Configured in `src/interfaces/http/index.ts`:

- `tokenTtlSeconds = 60 * 60` (1 hour)

### Endpoints

#### POST `/auth/login` (Public)

Request body (`src/interfaces/http/validators/auth.schema.ts`):

```json
{ "email": "user@example.com", "password": "..." }
```

Success 200:

```json
{
  "type": "bearer",
  "token": "<jwt>",
  "expiresAt": "2026-01-23T12:34:56.000Z",
  "user": {
    "id": "<uuid>",
    "email": "user@example.com",
    "name": "...",
    "timezone": "Asia/Taipei",
    "avatarUrl": "https://..."
  },
  "permissions": ["content:read", "roles:create", "..."]
}
```

`user.timezone` is optional (nullable). `user.avatarUrl` is a short-lived presigned URL when the user has an avatar; omitted otherwise. `permissions` is an array of `resource:action` strings for the current user (from their roles). Used by clients to gate UI; authorization is enforced on the API regardless.

Error:

- 400 invalid request
- 401 invalid credentials

Notes:

- The user must exist in DB (`users`) AND be `isActive=true`, even if the htshadow credentials match.

#### GET `/auth/session` (JWT required)

Behavior:

- Validates JWT
- Loads user by `sub` and requires `isActive=true`
- Issues a fresh JWT (sliding session behavior)
- Returns same shape as login, including `permissions`.

Success 200: same shape as `/auth/login` (includes `permissions`, and `user` includes `timezone` and `avatarUrl` when set).

Error:

- 401 invalid token / inactive user

#### PATCH `/auth/profile` (JWT required)

Update current user profile (name, timezone). No RBAC permission required.

Request body:

```json
{ "name": "...", "timezone": "Asia/Taipei" }
```

Both fields are optional. Validator: `name` non-empty, max 255; `timezone` max 64 chars, nullable.

Success 200: full auth payload (same shape as GET `/auth/session`), so the client can refresh session in one round-trip.

Error: 400 invalid request, 401 unauthorized, 404 user not found.

#### POST `/auth/password/change` (JWT required)

Change current user password. Verifies current password against htshadow, then updates the htshadow file with the new bcrypt hash.

Request body:

```json
{ "currentPassword": "...", "newPassword": "..." }
```

Validation: `newPassword` must be at least 8 characters.

Success 204, empty body.

Error: 400 invalid request (e.g. new password too short), 401 current password incorrect or unauthorized, 404 user not found.

#### PUT `/auth/me/avatar` (JWT required)

Upload or replace current user avatar. Accepts one image file (JPEG, PNG, WebP, GIF), max 2MB. Stored in MinIO at `avatars/<userId>`. Response includes full auth payload with updated `user.avatarUrl` (presigned).

Request: `multipart/form-data` with field `file` (image file).

Success 200: full auth payload (same shape as GET `/auth/session`).

Error: 400 invalid request (e.g. not an image or too large), 401 unauthorized, 404 user not found.

#### POST `/auth/logout` (JWT required)

Behavior:

- No-op logout (returns 204; there is no token revocation list).

Success 204, empty body.

---

## RBAC Module

Router: `src/interfaces/http/routes/rbac.route.ts` mounted at `/` (root).

### Purpose

Enforce authorization for staff endpoints via permission checks.

### Permission Model

Permission strings are `resource:action` (example: `playlists:read`).

Matching rules (`src/domain/rbac/permission.ts`):

- Non-Root users must match `resource` and `action` exactly.
- Root authorization is separate from normal permission matching and is resolved via `permissions.is_root` (`authorizationRepository.isRootUser(...)`).
- There is no wildcard permission (`*`) and no `manage` action.

### Seed Data (Canonical)

Seeding is consolidated into one command:

- `bun run db:seed`

Modes:

- `full` (default): seeds standard permissions, Root role (`root:access` marked with `is_root=true`), demo Editor/Viewer roles, 15 demo users, role assignments, and htshadow credentials.
- `baseline`: seeds standard permissions + Root role. Use `--email` to assign Root to a specific user.
- `root-only`: only ensures the Root role + Root permission; optionally assigns the role to `--email`.
- `permissions-only`: seeds only standard permissions + Root role/Root permission.

Flags:

- `--mode=full|baseline|root-only|permissions-only`
- `--email=user@example.com`
- `--dry-run` (no writes)
- `--strict` (fails on missing required data such as a target user)

Examples:

- `bun run db:seed`
- `bun run db:seed -- --mode=baseline --email=admin@example.com`
- `bun run db:seed -- --mode=root-only --dry-run`

### Database integrity check (before constraint rollout)

Run `bun run db:integrity` before applying schema hardening. It checks for:

- orphan creator references (`content.created_by_id`, `playlists.created_by_id`)
- orphan join-table references (`user_roles`, `role_permissions`)
- duplicate values that violate unique constraints (`users.email`, `roles.name`, `permissions(resource,action)`, `displays.identifier`)

### Endpoints (JWT + permission required)

All RBAC endpoints use `authorize("<permission>")`, which means:

- JWT is required
- Permission is evaluated via DB joins (user_roles -> role_permissions -> permissions)

#### Roles

- GET `/roles` requires `roles:read`
  - Response 200: `Role[]`

- POST `/roles` requires `roles:create`
  - Body:
    ```json
    { "name": "...", "description": "..." }
    ```
  - Response 201: `Role`

- GET `/roles/:id` requires `roles:read`
  - Response 200: `Role`
  - 404 if missing

- PATCH `/roles/:id` requires `roles:update`
  - Body:
    ```json
    { "name": "...", "description": "..." }
    ```
  - Response 200: `Role`

- DELETE `/roles/:id` requires `roles:delete`
  - Response 204
  - Response 403 if the role is a system role (e.g. Root); system roles cannot be deleted

- GET `/roles/:id/permissions` requires `roles:read`
  - Response 200: `Permission[]`

- PUT `/roles/:id/permissions` requires `roles:update`
  - Body:
    ```json
    { "permissionIds": ["..."] }
    ```
  - Response 200: `Permission[]` (resolved records for provided ids)

- GET `/roles/:id/users` requires `roles:read`
  - Response 200: `User[]` (users assigned to this role)
  - 404 if role missing

#### Permissions

- GET `/permissions` requires `roles:read`
  - Response 200: `Permission[]`

#### Users

- GET `/users` requires `users:read`
  - Response 200: `User[]`. Each user may include optional `avatarUrl` (presigned URL when the user has a profile picture in MinIO). `avatarKey` is never exposed.

- POST `/users` requires `users:create`
  - Body:
    ```json
    { "email": "user@example.com", "name": "...", "isActive": true }
    ```
  - Response 201: `User`

- GET `/users/:id` requires `users:read`
  - Response 200: `User`. May include optional `avatarUrl` (presigned URL when the user has a profile picture in MinIO). `avatarKey` is never exposed.

- GET `/users/:id/roles` requires `users:read`
  - Response 200: `Role[]` (roles assigned to this user)
  - 404 if user missing

- PATCH `/users/:id` requires `users:update`
  - Body:
    ```json
    { "email": "user@example.com", "name": "...", "isActive": true }
    ```
  - Response 200: `User`

- DELETE `/users/:id` requires `users:delete`
  - Response 204

- PUT `/users/:id/roles` requires `users:update`
  - Body:
    ```json
    { "roleIds": ["..."] }
    ```
  - Response 200: `Role[]`

---

## Content Module

Router: `src/interfaces/http/routes/content.route.ts` mounted at `/content`.

### Purpose

Upload, list, inspect, delete, and obtain download URLs for media.

### Supported MIME Types

Determined by `src/domain/content/content.ts`:

- Images: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- Video: `video/mp4`
- Document: `application/pdf`

### Storage Behavior

File key is generated as:

- `content/images/<uuid>.<ext>`
- `content/videos/<uuid>.<ext>`
- `content/documents/<uuid>.<ext>`

The file is uploaded to S3/MinIO and the DB record stores:

- `fileKey`
- `checksum` = sha256 hex of the full file bytes

Important: width/height/duration fields exist but are currently stored as `null` (no server-side inspection).

### Authentication / Authorization

All `/content` endpoints require:

- JWT (Bearer token)
- Permission:
  - `content:create`
  - `content:read`
  - `content:delete`

### Endpoints

#### POST `/content` (JWT + `content:create`)

Request:

- `multipart/form-data` with:
  - `title`: string
  - `file`: binary file
- Max upload size enforced by:
  - `CONTENT_MAX_UPLOAD_BYTES` (default 100 MiB)
  - `bodyLimit({ maxSize: ... })`

Response 201: `Content`

Errors:

- 400 invalid request / unsupported type
- 401/403 auth failures
- 404 if the authenticated user id does not exist in DB (`"User not found"`)

#### GET `/content` (JWT + `content:read`)

Query:

- `page` (int, min 1, default 1)
- `pageSize` (int, min 1, max 100, default 20)

Response 200:

```json
{ "items": [Content], "page": 1, "pageSize": 20, "total": 123 }
```

#### GET `/content/:id` (JWT + `content:read`)

Param:

- `id` must be UUID

Response 200: `Content`

404 if missing.

#### DELETE `/content/:id` (JWT + `content:delete`)

Behavior:

1. Loads content record
2. Deletes object from storage by `fileKey`
3. Deletes DB row

Response 204, empty body.

#### GET `/content/:id/file` (JWT + `content:read`)

Response 200:

```json
{ "downloadUrl": "https://..." }
```

The presigned URL expires after the configured TTL:

- in `src/interfaces/http/index.ts`: `downloadUrlExpiresInSeconds = 60 * 60` (1 hour)

---

## Playlists Module

Router: `src/interfaces/http/routes/playlists.route.ts` mounted at `/playlists`.

### Purpose

Manage playlists and their ordered items.

### Validation Rules

From `src/domain/playlists/playlist.ts`:

- `sequence` must be a positive integer
- `duration` must be a positive integer

Note: the API requires clients to provide `sequence`; it does not auto-assign it (even though `nextSequence(...)` exists as a helper).

### Authentication / Authorization

JWT + permission required:

- `playlists:read`
- `playlists:create`
- `playlists:update`
- `playlists:delete`

### Observability Actions

These endpoints set `action`:

- `playlists.playlist.list`
- `playlists.playlist.create`
- `playlists.playlist.get`
- `playlists.playlist.update`
- `playlists.playlist.delete`
- `playlists.item.create`
- `playlists.item.update`
- `playlists.item.delete`

### Endpoints

#### GET `/playlists` (JWT + `playlists:read`)

Response 200:

```json
{ "items": [Playlist] }
```

#### POST `/playlists` (JWT + `playlists:create`)

Body:

```json
{ "name": "...", "description": "..." }
```

Response 201: `Playlist`

#### GET `/playlists/:id` (JWT + `playlists:read`)

Response 200: `PlaylistWithItems`

404 if playlist missing.
Also returns 404 if any referenced content for an item is missing (`"Content not found"`).

#### PATCH `/playlists/:id` (JWT + `playlists:update`)

Body:

```json
{ "name": "...", "description": "..." }
```

Response 200: `Playlist`

#### DELETE `/playlists/:id` (JWT + `playlists:delete`)

Response 204

#### POST `/playlists/:id/items` (JWT + `playlists:update`)

Body:

```json
{ "contentId": "<uuid>", "sequence": 10, "duration": 15 }
```

Response 201: `PlaylistItem`

Errors:

- 400 if sequence/duration invalid
- 404 if playlist or content missing

#### PATCH `/playlists/:id/items/:itemId` (JWT + `playlists:update`)

Body:

```json
{ "sequence": 20, "duration": 10 }
```

Response 200: `PlaylistItem`

Errors:

- 400 if sequence/duration invalid
- 404 if item or content missing

#### DELETE `/playlists/:id/items/:itemId` (JWT + `playlists:update`)

Response 204

---

## Schedules Module

Router: `src/interfaces/http/routes/schedules.route.ts` mounted at `/schedules`.

### Purpose

Assign a playlist to a device for specific days/time windows, with conflict resolution via priority.

### Authentication / Authorization

JWT + permission required:

- `schedules:read`
- `schedules:create`
- `schedules:update`
- `schedules:delete`

### Observability Actions

- `schedules.schedule.list`
- `schedules.schedule.create`
- `schedules.schedule.get`
- `schedules.schedule.update`
- `schedules.schedule.delete`

### Schedule Validation

Use case validation (`src/application/use-cases/schedules/schedule.use-cases.ts`) enforces:

- `startTime` and `endTime` must match `HH:mm` (24h clock)
- `daysOfWeek` must be non-empty and each element must be an integer `0..6`

If invalid, the use case throws a `ValidationError` (`"Invalid time range"` / `"Invalid days of week"`), and the route maps it to:

- 400 `INVALID_REQUEST` with the thrown message

### Active Schedule Selection Rules (Critical)

Selection is implemented in `src/domain/schedules/schedule.ts`:

Given a device's schedules and a `now: Date`, the system:

1. Filters to schedules with `isActive === true`
2. Resolves day/time in `SCHEDULE_TIMEZONE` (default `UTC`)
3. Filters to schedules where `daysOfWeek` includes the resolved day
4. Filters to schedules where resolved time is within the schedule's time window using `isWithinTimeWindow(...)`
5. Sorts by `priority` descending and picks the first

Time window behavior:

- If `startTime === endTime`, the schedule is never active.
- If `startTime < endTime`, window is inclusive: `start <= time <= end`
- If `startTime > endTime`, the window wraps across midnight: `time >= start OR time <= end`

### Endpoints

#### GET `/schedules` (JWT + `schedules:read`)

Response 200:

```json
{ "items": [Schedule] }
```

#### POST `/schedules` (JWT + `schedules:create`)

Body:

```json
{
  "name": "...",
  "playlistId": "<uuid>",
  "deviceId": "<uuid>",
  "startTime": "08:00",
  "endTime": "17:00",
  "daysOfWeek": [1, 2, 3, 4, 5],
  "priority": 10,
  "isActive": true
}
```

Response 201: `Schedule`

404 if playlist/device missing.

#### GET `/schedules/:id` (JWT + `schedules:read`)

Response 200: `Schedule`
404 if missing.

#### PATCH `/schedules/:id` (JWT + `schedules:update`)

Body: same fields as create, all optional.

Response 200: `Schedule`

#### DELETE `/schedules/:id` (JWT + `schedules:delete`)

Response 204

---

## Displays Module

Router implementation: `src/interfaces/http/routes/devices.route.ts`, mounted in HTTP index at `/api/v1/displays`.

### Purpose

- Register displays (by stable `identifier`)
- Provide device inventory endpoints for staff
- Provide device polling endpoints (active schedule + manifest)

### Authentication / Authorization

There are two access modes:

1. Device mode (shared API key):

- `POST /displays`
- `GET /displays/:id/active-schedule`
- `GET /displays/:id/manifest`

2. Staff mode (JWT + RBAC permission):

- `GET /displays` requires `displays:read`
- `GET /displays/:id` requires `displays:read`

### Observability Actions

- `displays.device.register`
- `displays.device.list`
- `displays.device.get`
- `displays.schedule.read`
- `displays.manifest.read`

These actions also set `actorType` to `"device"` for device-authenticated endpoints.

### Device Registration Behavior

Registration is idempotent by `identifier` (`src/application/use-cases/devices/device.use-cases.ts`):

- If a device with the given identifier exists:
  - Update its `name` and `location`
- Else:
  - Create a new device record

Both `name` and `identifier` are trimmed; empty values are rejected.

### Endpoints

#### POST `/displays` (Device API key required)

Headers:

- `x-api-key: <DEVICE_API_KEY>`

Body:

```json
{ "identifier": "...", "name": "...", "location": "..." }
```

Response 200: `Device` (created or updated)

Errors:

- 401 if API key missing/invalid
- 400 if request invalid or name/identifier empty after trimming

#### GET `/displays` (JWT + `displays:read`)

Response 200:

```json
{ "items": [Device] }
```

#### GET `/displays/:id` (JWT + `displays:read`)

Response 200: `Device`
404 if missing.

#### GET `/displays/:id/active-schedule` (Device API key required)

Headers:

- `x-api-key: <DEVICE_API_KEY>`

Response 200:

- `Schedule` when a schedule is active
- `null` when no schedule is active

404 if device missing.

Selection uses the "Active Schedule Selection Rules" described in the Schedules module.

#### GET `/displays/:id/manifest` (Device API key required)

Headers:

- `x-api-key: <DEVICE_API_KEY>`

Response 200 (`src/interfaces/http/validators/displays.schema.ts`):

```ts
type DeviceManifest = {
  playlistId: string | null;
  playlistVersion: string;
  generatedAt: string;
  items: Array<{
    id: string;
    sequence: number;
    duration: number;
    content: {
      id: string;
      type: "IMAGE" | "VIDEO" | "PDF";
      checksum: string;
      downloadUrl: string;
      mimeType: string;
      width: number | null;
      height: number | null;
      duration: number | null;
    };
  }>;
};
```

Manifest generation (`src/application/use-cases/devices/device.use-cases.ts`):

- If no active schedule:
  - `playlistId: null`
  - `playlistVersion: ""`
  - `items: []`
  - `generatedAt: now.toISOString()`
- Else:
  - Loads playlist items ordered by `sequence` ascending
  - Loads each referenced content record
  - Generates presigned download URLs with bounded concurrency (8 workers) (`expiresInSeconds = 60*60` from `src/interfaces/http/index.ts`)
  - Computes `playlistVersion` as sha256 hex of this JSON payload:

```json
{
  "playlistId": "<playlistId>",
  "items": [
    {
      "id": "<playlistItemId>",
      "sequence": 10,
      "duration": 15,
      "contentId": "<contentId>",
      "checksum": "<sha256>"
    }
  ]
}
```

404 cases:

- 404 if device missing
- 404 if playlist/content referenced by the active schedule/items is missing

---

## OpenAPI + API Reference UI (Non-production only)

Enabled when `NODE_ENV !== "production"` (`src/interfaces/http/index.ts`):

- GET `/openapi.json`
- GET `/docs` (Scalar UI, pointing to `/openapi.json`)

---

## Environment Variables (Exact, from `src/env.ts`)

```env
# Server
PORT=3000
NODE_ENV=development
CORS_ORIGINS=http://localhost:3000

# Database
DATABASE_URL=...
MYSQL_ROOT_PASSWORD=...
MYSQL_HOST=...
MYSQL_PORT=3306
MYSQL_DATABASE=...
MYSQL_USER=...
MYSQL_PASSWORD=...

# MinIO / S3-compatible storage
# Ensure MinIO is running and reachable at MINIO_ENDPOINT:MINIO_PORT (protocol from MINIO_USE_SSL).
# The bucket named in MINIO_BUCKET must exist (create it in MinIO console or via mc); it is used for both content and avatar uploads.
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001
MINIO_USE_SSL=false
MINIO_BUCKET=content
MINIO_REGION=us-east-1
MINIO_REQUEST_TIMEOUT_MS=15000
CONTENT_MAX_UPLOAD_BYTES=104857600

# Auth (staff)
HTSHADOW_PATH=/etc/htshadow
JWT_SECRET=...
JWT_ISSUER=...

# Logging
LOG_LEVEL=info
LOG_PRETTY=true

# Audit
AUDIT_QUEUE_ENABLED=true
AUDIT_QUEUE_CAPACITY=5000
AUDIT_FLUSH_BATCH_SIZE=100
AUDIT_FLUSH_INTERVAL_MS=250
AUDIT_EXPORT_MAX_ROWS=100000

# Devices
SCHEDULE_TIMEZONE=UTC
DEVICE_API_KEY=...
```
