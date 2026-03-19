import { randomUUID } from "node:crypto";
import { type Context } from "hono";
import { setCookie } from "hono/cookie";

export const setAuthSessionCookie = (
  c: Context,
  cookieName: string,
  token: string,
  expiresAt: string,
  secureCookies: boolean,
) => {
  setCookie(c, cookieName, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "Strict",
    path: "/",
    expires: new Date(expiresAt),
  });
};

export const setCsrfCookie = (
  c: Context,
  csrfCookieName: string,
  secureCookies: boolean,
): void => {
  setCookie(c, csrfCookieName, randomUUID(), {
    httpOnly: false,
    secure: secureCookies,
    sameSite: "Strict",
    path: "/",
  });
};
