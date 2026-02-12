import { bodyLimit } from "hono/body-limit";
import { describeRoute, resolver } from "hono-openapi";
import {
  InvalidContentTypeError,
  NotFoundError,
} from "#/application/use-cases/content";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  badRequest,
  errorResponseSchema,
  notFound,
} from "#/interfaces/http/responses";
import {
  contentIdParamSchema,
  contentSchema,
  contentUploadRequestBodySchema,
  createUploadContentSchema,
} from "#/interfaces/http/validators/content.schema";
import {
  validateForm,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";
import {
  type ContentRouter,
  type ContentRouterUseCases,
  contentTags,
  type RequirePermission,
} from "./shared";

export const registerContentWriteRoutes = (args: {
  router: ContentRouter;
  useCases: ContentRouterUseCases;
  requirePermission: RequirePermission;
  maxUploadBytes: number;
}) => {
  const { router, useCases, requirePermission, maxUploadBytes } = args;
  const uploadSchema = createUploadContentSchema(maxUploadBytes);

  router.post(
    "/",
    setAction("content.content.create", {
      route: "/content",
      resourceType: "content",
    }),
    requirePermission("content:create"),
    bodyLimit({ maxSize: maxUploadBytes }),
    validateForm(uploadSchema),
    describeRoute({
      description: "Upload a content file",
      tags: contentTags,
      requestBody: {
        content: {
          "multipart/form-data": {
            schema: contentUploadRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        201: {
          description: "Content created",
          content: {
            "application/json": {
              schema: resolver(contentSchema),
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
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        403: {
          description: "Forbidden",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const payload = c.req.valid("form");
      try {
        const result = await useCases.uploadContent.execute({
          title: payload.title,
          file: payload.file,
          createdById: c.get("userId"),
        });
        c.set("resourceId", result.id);
        return c.json(result, 201);
      } catch (error) {
        if (error instanceof InvalidContentTypeError) {
          return badRequest(c, error.message);
        }
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.delete(
    "/:id",
    setAction("content.content.delete", {
      route: "/content/:id",
      resourceType: "content",
    }),
    requirePermission("content:delete"),
    validateParams(contentIdParamSchema),
    describeRoute({
      description: "Delete content",
      tags: contentTags,
      responses: {
        204: { description: "Deleted" },
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
        await useCases.deleteContent.execute({ id: params.id });
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );
};
