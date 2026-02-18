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

  if (action === "authz.permission.deny") {
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
  // Deployment assumes these headers are set by trusted upstream proxies.
  // If requests can bypass the proxy, these values can be spoofed.
  const forwardedFor = headers.forwardedFor?.split(",")[0]?.trim();
  if (forwardedFor) return forwardedFor;

  const realIp = headers.realIp?.trim();
  if (realIp) return realIp;

  return undefined;
};

const buildSafeAuditMetadata = (input: {
  sessionId?: string;
  fileId?: string;
  rbacPolicyVersion?: string;
  rbacTargetCount?: string;
  deniedPermission?: string;
  denyErrorCode?: string;
  denyErrorType?: string;
}): string | undefined => {
  const metadata: Record<string, string> = {};
  if (input.sessionId) {
    metadata.sessionId = input.sessionId;
  }
  if (input.fileId) {
    metadata.fileId = input.fileId;
  }
  if (input.rbacPolicyVersion) {
    metadata.rbacPolicyVersion = input.rbacPolicyVersion;
  }
  if (input.rbacTargetCount) {
    metadata.rbacTargetCount = input.rbacTargetCount;
  }
  if (input.deniedPermission) {
    metadata.deniedPermission = input.deniedPermission;
  }
  if (input.denyErrorCode) {
    metadata.denyErrorCode = input.denyErrorCode;
  }
  if (input.denyErrorType) {
    metadata.denyErrorType = input.denyErrorType;
  }
  return Object.keys(metadata).length > 0
    ? JSON.stringify(metadata)
    : undefined;
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
    const sessionId = c.get("sessionId");
    const fileId = c.get("fileId");
    const rbacPolicyVersion = c.get("rbacPolicyVersion");
    const rbacTargetCount = c.get("rbacTargetCount");
    const deniedPermission = c.get("deniedPermission");
    const denyErrorCode = c.get("denyErrorCode");
    const denyErrorType = c.get("denyErrorType");
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
      metadataJson: buildSafeAuditMetadata({
        sessionId,
        fileId,
        rbacPolicyVersion,
        rbacTargetCount,
        deniedPermission,
        denyErrorCode,
        denyErrorType,
      }),
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
