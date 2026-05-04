import { type Context } from "hono";

export const getOwnerScope = (c: Context): string | undefined =>
  c.get("isAdmin") === true ? undefined : c.get("userId");
