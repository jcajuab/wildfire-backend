import { describeRoute, resolver } from "hono-openapi";
import { NotFoundError } from "#/application/use-cases/content";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema, notFound } from "#/interfaces/http/responses";
import {
  contentIdParamSchema,
  downloadUrlResponseSchema,
} from "#/interfaces/http/validators/content.schema";
import { validateParams } from "#/interfaces/http/validators/standard-validator";
import {
  type ContentRouter,
  type ContentRouterUseCases,
  contentTags,
  type RequirePermission,
} from "./shared";

export const registerContentFileRoutes = (args: {
  router: ContentRouter;
  useCases: ContentRouterUseCases;
  requirePermission: RequirePermission;
}) => {
  const { router, useCases, requirePermission } = args;

  router.get(
    "/:id/file",
    setAction("content.file.download", {
      route: "/content/:id/file",
      resourceType: "content",
    }),
    requirePermission("content:read"),
    validateParams(contentIdParamSchema),
    describeRoute({
      description: "Get presigned content download URL",
      tags: contentTags,
      responses: {
        200: {
          description: "Download URL",
          content: {
            "application/json": {
              schema: resolver(downloadUrlResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        404: {
          description: "Not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const params = c.req.valid("param");
      c.set("resourceId", params.id);
      try {
        const result = await useCases.getDownloadUrl.execute({ id: params.id });
        return c.json(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );
};
