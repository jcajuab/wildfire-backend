# Backend Logging Best Practices

## Scope

This document defines the standard logging contract for the backend runtime.
All logs must follow this contract to preserve observability, improve incident triage,
and keep output machine-friendly while readable in local development.

## Global requirements

- Use structured JSON logs from `pino`.
- Keep event payload keys consistent.
- Use `error` (not `err`, `errorMessage`, etc.) for all error objects.
- Keep log messages short; prefer parsing from payload fields when needed.
- Log at `info` for normal success flow, `warn` for recoverable issues, and `error` for terminal failures.
- Keep messages stable; use the same event key for the same operational action.
- Never pass raw secrets, tokens, passwords, or full stack traces in non-error logs.
- Keep logging human-readable in local environments by default with `LOG_PRETTY=true`.
- Keep request idle timeouts explicit and centralized with `IDLE_TIMEOUT_MS` (`0` disables request idle timeouts).

## Canonical payload schema

### Shared fields

- `event` (string): canonical action name for the event.
- `component` (string): module or layer (`http`, `redis`, `storage`, `startup`, `audit`, etc.).
- `status` (string): lifecycle status when applicable (`started`, `succeeded`, `failed`, `degraded`).
- `service` (string): fixed to `wildfire`.
- `durationMs` (number): elapsed milliseconds when relevant.
- `requestId` (string): request correlation ID for HTTP requests.

### Error field

`error` must be an object:

- `name` (string)
- `message` (string)
- `code` (string, optional)
- `stack` (string, optional)

Use `addErrorContext(payload, err)` from
`#/infrastructure/observability/logging` to keep this contract.

### Request logs (`http.*`)

Required fields:

- `event`: `http.request.completed` or `http.request.error`
- `component`: `http`
- `requestId`
- `method`
- `path`
- `status`
- `durationMs`
- `action` (if available)
- `route` (if available)
- `actorId` (if available)
- `actorType` (if available)
- `resourceType` (if available)
- `resourceId` (if available)

### Startup logs (`startup.*`)

Required fields:

- `event`: `startup.phase`
- `component`: `api-bootstrap`
- `phase`
- `operation`
- `status`
- `runId`
- `durationMs` for completed/degraded/failed states

### Redis logs (`redis.*`)

Required fields:

- `event` when possible (`redis.connection`, `redis.connection.error`, etc.)
- `redisConnection`
- `error` for failures

### Queue/Worker logs (`audit.*`)

Required fields:

- `streamName`
- `streamGroup`
- `consumerName` (worker)
- `requestId`/`action`/`streamEntryId` where event-specific.

## Log level usage

- `info`: normal startup milestones, completed requests, successful side effects.
- `warn`: non-fatal recoverable failures and expected partial degradation.
- `error`: unhandled failures and terminal errors that require intervention.

## Example payloads

- `http.request.completed`

```json
{
  "event": "http.request.completed",
  "component": "http",
  "requestId": "4f1f...",
  "method": "GET",
  "path": "/api/v1/displays",
  "status": 200,
  "durationMs": 33,
  "route": "/displays",
  "actorId": "02e706...",
  "actorType": "user"
}
```

- `redis.connection.error`

```json
{
  "event": "redis.connection.error",
  "component": "redis",
  "redisConnection": "command",
  "error": {
    "name": "SocketTimeoutError",
    "message": "Socket timeout timeout. Expecting data, but didn't receive any in 30000ms.",
    "code": "ETIMEDOUT"
  }
}
```

- `startup.phase`

```json
{
  "event": "startup.phase",
  "component": "api-bootstrap",
  "phase": "storage",
  "operation": "check-connectivity",
  "status": "succeeded",
  "runId": "minio-bootstrap-123",
  "durationMs": 11
}
```

## Implementation checklist

- Use `logger.info`, `logger.warn`, and `logger.error` with structured payloads.
- Use `addErrorContext` for all error logs.
- Keep startup and stream/worker logs aligned with the schemas above.
- Add/adjust tests when schema shape changes for new logs in critical paths.
- Do not introduce one-off logging keys unless justified by monitoring requirements.
