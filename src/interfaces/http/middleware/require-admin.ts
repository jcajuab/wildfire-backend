import { type MiddlewareHandler } from "hono";
import { forbidden } from "#/interfaces/http/responses";
import { type JwtUserVariables } from "./jwt-user";

export const requireAdmin: MiddlewareHandler<{
  Variables: JwtUserVariables;
}> = async (c, next) => {
  if (c.get("isAdmin") !== true) {
    return forbidden(c, "Admin role required");
  }
  await next();
};
