import { type MiddlewareHandler } from "hono";
import { unauthorized } from "#/interfaces/http/responses";
import { jwtPayloadSchema } from "#/interfaces/http/validators/jwt.schema";

export type JwtUserVariables = {
  userId: string;
  userEmail?: string;
  sessionId?: string;
  fileId?: string;
  action?: string;
  route?: string;
  actorId?: string;
  actorType?: "user" | "display";
  resourceId?: string;
  resourceType?: string;
  rbacPolicyVersion?: string;
  rbacTargetCount?: string;
};

export const requireJwtUser: MiddlewareHandler<{
  Variables: JwtUserVariables;
}> = async (c, next) => {
  const parsed = jwtPayloadSchema.safeParse(c.get("jwtPayload"));
  if (!parsed.success) {
    return unauthorized(c, "Invalid token");
  }

  c.set("userId", parsed.data.sub);
  if (parsed.data.email) {
    c.set("userEmail", parsed.data.email);
  }
  if (parsed.data.sid) {
    c.set("sessionId", parsed.data.sid);
  } else if (parsed.data.jti) {
    c.set("sessionId", parsed.data.jti);
  } else if (parsed.data.iat) {
    c.set("sessionId", `${parsed.data.sub}:${parsed.data.iat}`);
  }

  await next();
};
