import { resolver } from "hono-openapi";
import { errorResponseSchema } from "#/interfaces/http/responses";

const jsonErrorContent = {
  "application/json": {
    schema: resolver(errorResponseSchema),
  },
} as const;

export const invalidRequestResponse = {
  description: "Bad request",
  content: jsonErrorContent,
} as const;

export const validationErrorResponse = {
  description: "Validation failed",
  content: jsonErrorContent,
} as const;

export const unauthorizedResponse = {
  description: "Unauthorized",
  content: jsonErrorContent,
} as const;

export const forbiddenResponse = {
  description: "Forbidden",
  content: jsonErrorContent,
} as const;

export const notFoundResponse = {
  description: "Not found",
  content: jsonErrorContent,
} as const;

export const conflictResponse = {
  description: "Conflict",
  content: jsonErrorContent,
} as const;
