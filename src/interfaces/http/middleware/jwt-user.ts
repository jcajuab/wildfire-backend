import { type MiddlewareHandler } from "hono";
import { extractSessionId } from "#/interfaces/http/lib/session-id";
import { unauthorized } from "#/interfaces/http/responses";
import { jwtPayloadSchema } from "#/interfaces/http/validators/jwt.schema";

export type JwtUserVariables = {
  userId: string;
  username?: string;
  userEmail?: string;
  sessionId?: string;
  deniedPermission?: string;
  denyErrorCode?: string;
  denyErrorType?: string;
  fileId?: string;
  action?: string;
  route?: string;
  actorId?: string;
  actorType?: "user" | "display";
  resourceId?: string;
  resourceType?: string;
  rbacAssignmentCount?: string;
};

export const requireJwtUser: MiddlewareHandler<{
  Variables: JwtUserVariables;
}> = async (c, next) => {
  const parsed = jwtPayloadSchema.safeParse(c.get("jwtPayload"));
  if (!parsed.success) {
    return unauthorized(c, "Invalid token");
  }

  c.set("userId", parsed.data.sub);
  c.set("username", parsed.data.username);
  if (parsed.data.email) {
    c.set("userEmail", parsed.data.email);
  }
  const sessionId = extractSessionId(parsed.data);
  if (sessionId) {
    c.set("sessionId", sessionId);
  }

  await next();
};
