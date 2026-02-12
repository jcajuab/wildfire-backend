import { type MiddlewareHandler } from "hono";
import { unauthorized } from "#/interfaces/http/responses";
import { jwtPayloadSchema } from "#/interfaces/http/validators/jwt.schema";

export type JwtUserVariables = {
  userId: string;
  userEmail?: string;
  action?: string;
  route?: string;
  actorId?: string;
  actorType?: "user" | "device";
  resourceId?: string;
  resourceType?: string;
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

  await next();
};
