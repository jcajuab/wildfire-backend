import { bodyLimit } from "hono/body-limit";
import { describeRoute, resolver } from "hono-openapi";
import {
  ContentInUseError,
  InvalidContentTypeError,
} from "#/application/use-cases/content";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  badRequest,
  conflict,
  errorResponseSchema,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  contentIdParamSchema,
  contentSchema,
  contentUploadRequestBodySchema,
  createUploadContentSchema,
  updateContentRequestBodySchema,
  updateContentSchema,
} from "#/interfaces/http/validators/content.schema";
import {
  validateForm,
  validateJson,
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
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("form");
        const result = await useCases.uploadContent.execute({
          title: payload.title,
          file: payload.file,
          createdById: c.get("userId"),
        });
        c.set("resourceId", result.id);
        c.set("fileId", result.id);
        return c.json(result, 201);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(ContentInUseError, conflict),
      mapErrorToResponse(InvalidContentTypeError, badRequest),
    ),
  );

  router.patch(
    "/:id",
    setAction("content.content.update", {
      route: "/content/:id",
      resourceType: "content",
    }),
    requirePermission("content:update"),
    validateParams(contentIdParamSchema),
    validateJson(updateContentSchema),
    describeRoute({
      description: "Update content metadata",
      tags: contentTags,
      requestBody: {
        content: {
          "application/json": {
            schema: updateContentRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Content updated",
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
        404: {
          description: "Not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        409: {
          description: "Conflict (content is currently referenced)",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const body = c.req.valid("json");
        c.set("resourceId", params.id);
        c.set("fileId", params.id);
        const result = await useCases.updateContent.execute({
          id: params.id,
          title: body.title,
          status: body.status,
        });
        return c.json(result, 200);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(ContentInUseError, conflict),
    ),
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
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        c.set("fileId", params.id);
        await useCases.deleteContent.execute({ id: params.id });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
