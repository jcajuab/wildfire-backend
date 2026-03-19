<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-19 -->

# middleware

## Purpose

Hono middleware for cross-cutting HTTP concerns: authentication, authorization, audit logging, and request observability.

## Key Files

| File               | Description                                                                   |
| ------------------ | ----------------------------------------------------------------------------- |
| `jwt-auth.ts`      | JWT token extraction and validation — sets `c.var.user`                       |
| `jwt-user.ts`      | Optional JWT user extraction (does not reject unauthenticated)                |
| `permissions.ts`   | Permission-based authorization — checks user permissions against required set |
| `audit-trail.ts`   | Auto-logs HTTP requests to the audit queue with route metadata                |
| `observability.ts` | Request ID generation, logging context, timing                                |

## For AI Agents

### Working In This Directory

- `jwt-auth` is required middleware for authenticated routes — returns 401 if no valid token
- `permissions` middleware returns 403 if user lacks required permissions
- Audit trail middleware captures: method, path, route pattern, status, actor, timing
- Middleware order matters: observability → jwt-auth → permissions → audit-trail → route handler

<!-- MANUAL: -->
