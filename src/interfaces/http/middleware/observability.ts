import { type MiddlewareHandler } from "hono";
import { type RequestIdVariables, requestId } from "hono/request-id";
import { logger } from "#/infrastructure/observability/logger";

export { requestId };

export type ObservabilityVariables = RequestIdVariables & {
  action?: string;
  route?: string;
  actorId?: string;
  actorType?: "user" | "display";
  resourceId?: string;
  resourceType?: string;
  userId?: string;
  sessionId?: string;
  fileId?: string;
  rbacPolicyVersion?: string;
  rbacTargetCount?: string;
  deniedPermission?: string;
  denyErrorCode?: string;
  denyErrorType?: string;
};

export const setAction =
  (
    action: string,
    meta?: {
      route?: string;
      actorId?: string;
      actorType?: "user" | "display";
      resourceId?: string;
      resourceType?: string;
    },
  ): MiddlewareHandler =>
  async (c, next) => {
    c.set("action", action);
    if (meta?.route) c.set("route", meta.route);
    if (meta?.actorId) c.set("actorId", meta.actorId);
    if (meta?.actorType) c.set("actorType", meta.actorType);
    if (meta?.resourceId) c.set("resourceId", meta.resourceId);
    if (meta?.resourceType) c.set("resourceType", meta.resourceType);
    await next();
  };

const getRouteTemplate = (c: { req: { path: string } }) => {
  if ("routePath" in c.req) {
    return (c.req as { routePath: string }).routePath;
  }
  return c.req.path;
};

export const requestLogger: MiddlewareHandler<{
  Variables: ObservabilityVariables;
}> = async (c, next) => {
  const start = Date.now();
  await next();
  const requestId = c.get("requestId");
  const action = c.get("action");
  const route = c.get("route") ?? getRouteTemplate(c);
  const actorId = c.get("actorId") ?? c.get("userId");
  const actorType = c.get("actorType") ?? (actorId ? "user" : undefined);
  const resourceId = c.get("resourceId");
  const resourceType = c.get("resourceType");
  const sessionId = c.get("sessionId");
  const fileId =
    c.get("fileId") ??
    (resourceType === "content" && resourceId != null ? resourceId : undefined);
  const durationMs = Date.now() - start;
  const status = c.res.status;
  const method = c.req.method;
  const path = c.req.path;

  const logPayload: Record<string, unknown> = {
    requestId,
    method,
    path,
    status,
    durationMs,
  };

  if (action) logPayload.action = action;
  if (route) logPayload.route = route;
  if (actorId) logPayload.actorId = actorId;
  if (actorType) logPayload.actorType = actorType;
  if (resourceId) logPayload.resourceId = resourceId;
  if (resourceType) logPayload.resourceType = resourceType;
  if (sessionId) logPayload.sessionId = sessionId;
  if (fileId) logPayload.fileId = fileId;

  logger.info(logPayload, "request completed");
};
