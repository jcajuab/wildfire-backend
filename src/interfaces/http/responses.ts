import { type Context } from "hono";
import { z } from "zod";

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const notImplemented = (c: Context, message: string) =>
  c.json<ErrorResponse>(
    {
      error: {
        code: "NOT_IMPLEMENTED",
        message,
      },
    },
    501,
  );

export const badRequest = (c: Context, message: string) =>
  c.json<ErrorResponse>(
    {
      error: {
        code: "INVALID_REQUEST",
        message,
      },
    },
    400,
  );

export const unauthorized = (c: Context, message: string) =>
  c.json<ErrorResponse>(
    {
      error: {
        code: "UNAUTHORIZED",
        message,
      },
    },
    401,
  );

export const forbidden = (c: Context, message: string) =>
  c.json<ErrorResponse>(
    {
      error: {
        code: "FORBIDDEN",
        message,
      },
    },
    403,
  );

export const notFound = (c: Context, message: string) =>
  c.json<ErrorResponse>(
    {
      error: {
        code: "NOT_FOUND",
        message,
      },
    },
    404,
  );

export const conflict = (c: Context, message: string) =>
  c.json<ErrorResponse>(
    {
      error: {
        code: "CONFLICT",
        message,
      },
    },
    409,
  );

export const internalServerError = (c: Context, message: string) =>
  c.json<ErrorResponse>(
    {
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    },
    500,
  );
