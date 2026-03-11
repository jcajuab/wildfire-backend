import { type Context } from "hono";
import { setCookie } from "hono/cookie";

export const setAuthSessionCookie = (
  c: Context,
  cookieName: string,
  token: string,
  expiresAt: string,
) => {
  setCookie(c, cookieName, token, {
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    sameSite: "Lax",
    path: "/",
    expires: new Date(expiresAt),
  });
};
