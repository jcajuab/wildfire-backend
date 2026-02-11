# Wildfire Backend Overview (Source-of-Truth Spec)

This document is a module-by-module specification of the Wildfire backend, derived from the current code in:

- `src/interfaces/http/index.ts`
- `src/interfaces/http/routes/*.ts`
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
- `requestLogger` logs on completion

Log payload always includes:

- `requestId`, `method`, `path`, `status`, `durationMs`

It may also include:

- `action` (set explicitly by routes using `setAction(...)`)
- `route` (template if available, else actual path)
- `actorId`, `actorType` (`"user"` or `"device"`)
- `resourceId`, `resourceType`

Error handling (`app.onError`) logs:

- `logger.error(...)` for status >= 500
- `logger.warn(...)` for status < 500

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
type User = { id: string; email: string; name: string; isActive: boolean };
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

1. Device registers (or updates) itself via `POST /devices` with `x-api-key`.
2. Device fetches active schedule via `GET /devices/:id/active-schedule` (optional; returns `Schedule | null`).
3. Device fetches manifest via `GET /devices/:id/manifest`.
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
  "user": { "id": "<uuid>", "email": "user@example.com", "name": "..." },
  "permissions": ["content:read", "roles:create", "..."]
}
```

`permissions` is an array of `resource:action` strings for the current user (from their roles). Used by clients to gate UI; authorization is enforced on the API regardless.

Error:

- 400 invalid request
- 401 invalid credentials

Notes:

- The user must exist in DB (`users`) AND be `isActive=true`, even if the htshadow credentials match.

#### GET `/auth/me` (JWT required)

Behavior:

- Validates JWT
- Loads user by `sub` and requires `isActive=true`
- Issues a fresh JWT (sliding session behavior)
- Returns same shape as login, including `permissions`.

Success 200: same shape as `/auth/login` (includes `permissions`).

Error:

- 401 invalid token / inactive user

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

- Resource matches if equal or stored resource is `"*"`
- Action matches if equal, OR stored action is `"manage"` (wildcard for actions)
- Example: `"*:manage"` grants all permissions

### Seed: Super Admin Role

A built-in seed exists (`src/application/use-cases/rbac/seed-super-admin.use-case.ts`):

- Role name: `"Super Admin"` (isSystem=true)
- Permission: `{ resource: "*", action: "manage" }`
- Ensures the role has that permission assigned

Run via: `bun run db:seed:super-admin` (script entrypoint: `scripts/seed-super-admin.ts`).

### Seed: Standard Permissions

A separate seed populates the `permissions` table with all standard `resource:action` pairs used by the app (content, playlists, schedules, devices, roles, users). Idempotent: skips any permission that already exists.

Run via: `bun run db:seed:permissions` (script entrypoint: `scripts/seed-standard-permissions.ts`). Typical order: run `db:seed:permissions` first so `GET /permissions` returns the full list, then `db:seed:super-admin` to create the Super Admin role and assign `*:manage`.

### Seed: Assign Super Admin to user by email

Assigns the "Super Admin" role (all permissions) to a user by email so they can call RBAC endpoints. Default email: `test@example.com`. Optional env: `SEED_USER_EMAIL`.

Run via: `bun run db:seed:assign-super-admin` (script entrypoint: `scripts/assign-super-admin-to-user.ts`). Requires the user to exist in the `users` table and the Super Admin role to exist (`db:seed:super-admin`).

### Seed: Dummy users and roles (for testing UI)

Seeds 15 dummy users into the DB and the htshadow file so the Users and Roles pages can be tested with real data. Also ensures standard permissions and Super Admin role exist, creates "Editor" and "Viewer" roles with appropriate permissions, and assigns roles: 1 Super Admin, 5 Editors, 9 Viewers. All seeded users share password: `password`. Set `HTSHADOW_PATH` in `.env` to the path of your htshadow file (e.g. absolute path to `wildfire/htshadow`).

Run via: `bun run db:seed:dummy-users` (script entrypoint: `scripts/seed-dummy-users-and-roles.ts`). Typical order: `db:seed:permissions` → `db:seed:super-admin` (or let this script run them), then `db:seed:dummy-users`.

### Database preflight (before constraint rollout)

Run `bun run db:preflight` before applying schema hardening. It checks for:

- orphan creator references (`content.created_by_id`, `playlists.created_by_id`)
- orphan join-table references (`user_roles`, `role_permissions`)
- duplicate values that violate unique constraints (`users.email`, `roles.name`, `permissions(resource,action)`, `devices.identifier`)

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
  - Response 403 if the role is a system role (e.g. Super Admin); system roles cannot be deleted

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
  - Response 200: `User[]`

- POST `/users` requires `users:create`
  - Body:
    ```json
    { "email": "user@example.com", "name": "...", "isActive": true }
    ```
  - Response 201: `User`

- GET `/users/:id` requires `users:read`
  - Response 200: `User`

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

- `playlists.list`
- `playlists.create`
- `playlists.get`
- `playlists.update`
- `playlists.delete`
- `playlists.item.add`
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

- `schedules.list`
- `schedules.create`
- `schedules.get`
- `schedules.update`
- `schedules.delete`

### Schedule Validation

Use case validation (`src/application/use-cases/schedules/schedule.use-cases.ts`) enforces:

- `startTime` and `endTime` must match `HH:mm` (24h clock)
- `daysOfWeek` must be non-empty and each element must be an integer `0..6`

If invalid, the use case throws an `Error("Invalid time range")` or `Error("Invalid days of week")`, and the route maps it to:

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

## Devices Module

Router: `src/interfaces/http/routes/devices.route.ts` mounted at `/devices`.

### Purpose

- Register devices (by stable `identifier`)
- Provide device inventory endpoints for staff
- Provide device polling endpoints (active schedule + manifest)

### Authentication / Authorization

There are two access modes:

1. Device mode (shared API key):

- `POST /devices`
- `GET /devices/:id/active-schedule`
- `GET /devices/:id/manifest`

2. Staff mode (JWT + RBAC permission):

- `GET /devices` requires `devices:read`
- `GET /devices/:id` requires `devices:read`

### Observability Actions

- `devices.register`
- `devices.list`
- `devices.get`
- `devices.activeSchedule.read`
- `devices.manifest.read`

These actions also set `actorType` to `"device"` for device-authenticated endpoints.

### Device Registration Behavior

Registration is idempotent by `identifier` (`src/application/use-cases/devices/device.use-cases.ts`):

- If a device with the given identifier exists:
  - Update its `name` and `location`
- Else:
  - Create a new device record

Both `name` and `identifier` are trimmed; empty values are rejected.

### Endpoints

#### POST `/devices` (Device API key required)

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

#### GET `/devices` (JWT + `devices:read`)

Response 200:

```json
{ "items": [Device] }
```

#### GET `/devices/:id` (JWT + `devices:read`)

Response 200: `Device`
404 if missing.

#### GET `/devices/:id/active-schedule` (Device API key required)

Headers:

- `x-api-key: <DEVICE_API_KEY>`

Response 200:

- `Schedule` when a schedule is active
- `null` when no schedule is active

404 if device missing.

Selection uses the "Active Schedule Selection Rules" described in the Schedules module.

#### GET `/devices/:id/manifest` (Device API key required)

Headers:

- `x-api-key: <DEVICE_API_KEY>`

Response 200 (`src/interfaces/http/validators/devices.schema.ts`):

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
  - Generates a presigned download URL per content (`expiresInSeconds = 60*60` from `src/interfaces/http/index.ts`)
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

# Database
DATABASE_URL=...
MYSQL_ROOT_PASSWORD=...
MYSQL_HOST=...
MYSQL_PORT=3306
MYSQL_DATABASE=...
MYSQL_USER=...
MYSQL_PASSWORD=...

# MinIO / S3-compatible storage
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001
MINIO_USE_SSL=false
MINIO_BUCKET=content
MINIO_REGION=us-east-1
CONTENT_MAX_UPLOAD_BYTES=104857600

# Auth (staff)
HTSHADOW_PATH=/etc/htshadow
JWT_SECRET=...
JWT_ISSUER=...

# Logging
LOG_LEVEL=info
LOG_PRETTY=true
SCHEDULE_TIMEZONE=UTC

# Devices
DEVICE_API_KEY=...
```
