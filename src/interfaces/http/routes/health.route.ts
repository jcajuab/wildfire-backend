import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { apiResponseSchema } from "#/interfaces/http/responses";

export const healthRouter = new Hono();
const healthTags = ["Health"];

const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

healthRouter.get(
  "/",
  describeRoute({
    description: "Health check",
    tags: healthTags,
    responses: {
      200: {
        description: "Service healthy",
        content: {
          "application/json": {
            schema: resolver(apiResponseSchema(healthResponseSchema)),
          },
        },
      },
    },
  }),
  (c) => c.json({ status: "ok" }),
);
