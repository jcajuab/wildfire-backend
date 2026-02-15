import { type MiddlewareHandler } from "hono";
import { logger } from "#/infrastructure/observability/logger";
import { type AuditEventQueue } from "#/interfaces/http/audit/in-memory-audit-queue";
import { type ObservabilityVariables } from "#/interfaces/http/middleware/observability";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const AUTH_SECURITY_ACTIONS = new Set([
  "auth.session.login",
  "auth.session.logout",
  "auth.password.update",
  "auth.profile.update",
  "auth.avatar.update",
  "auth.account.delete",
]);

const shouldCaptureByAction = (action: string): boolean => {
  if (AUTH_SECURITY_ACTIONS.has(action)) {
    return true;
  }

  if (!action.startsWith("rbac.")) {
    return false;
  }

  const operation = action.split(".").at(-1);
  return (
    operation === "create" ||
    operation === "update" ||
    operation === "delete" ||
    operation === "set"
  );
};

const shouldCaptureEvent = (input: { method: string; action?: string }) => {
  if (!input.action) {
    return false;
  }

  if (shouldCaptureByAction(input.action)) {
    return true;
  }

  return MUTATING_METHODS.has(input.method.toUpperCase());
};

const resolveIpAddress = (headers: {
  forwardedFor?: string;
  realIp?: string;
}): string | undefined => {
  const forwardedFor = headers.forwardedFor?.split(",")[0]?.trim();
  if (forwardedFor) return forwardedFor;

  const realIp = headers.realIp?.trim();
  if (realIp) return realIp;

  return undefined;
};

export const createAuditTrailMiddleware = (deps: {
  auditQueue: AuditEventQueue;
}): MiddlewareHandler<{ Variables: ObservabilityVariables }> => {
  return async (c, next) => {
    await next();

    const method = c.req.method.toUpperCase();
    const action = c.get("action");
    if (!action || !shouldCaptureEvent({ method, action })) {
      return;
    }

    const requestId = c.get("requestId");
    const actorId = c.get("actorId") ?? c.get("userId");
    const actorType = c.get("actorType") ?? (actorId ? "user" : undefined);
    const route = c.get("route");
    const resourceId = c.get("resourceId");
    const resourceType = c.get("resourceType");
    const ipAddress = resolveIpAddress({
      forwardedFor: c.req.header("x-forwarded-for"),
      realIp: c.req.header("x-real-ip"),
    });
    const userAgent = c.req.header("user-agent");

    const result = deps.auditQueue.enqueue({
      requestId,
      action,
      route,
      method,
      path: c.req.path,
      status: c.res.status,
      actorId,
      actorType,
      resourceId,
      resourceType,
      ipAddress,
      userAgent,
    });

    if (!result.accepted && result.reason === "overflow") {
      logger.warn(
        {
          requestId,
          action,
          reason: result.reason,
        },
        "audit event dropped",
      );
    }
  };
};
