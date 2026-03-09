import { bodyLimit } from "hono/body-limit";
import { describeRoute, resolver } from "hono-openapi";
import {
  ContentInUseError,
  InvalidContentTypeError,
} from "#/application/use-cases/content";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  conflict,
  errorResponseSchema,
  toApiResponse,
  validationError,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  mapErrorToResponse,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  contentExclusionRequestBodySchema,
  contentExclusionSchema,
  contentIdParamSchema,
  contentIngestionAcceptedSchema,
  contentSchema,
  contentUploadRequestBodySchema,
  createFlashContentRequestBodySchema,
  createFlashContentSchema,
  createReplaceContentFileSchema,
  createUploadContentSchema,
  replaceContentFileRequestBodySchema,
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
  videoMaxUploadBytes: number;
}) => {
  const {
    router,
    useCases,
    requirePermission,
    maxUploadBytes,
    videoMaxUploadBytes,
  } = args;
  const uploadSchema = createUploadContentSchema(
    maxUploadBytes,
    videoMaxUploadBytes,
  );
  const replaceContentFileSchema = createReplaceContentFileSchema(
    maxUploadBytes,
    videoMaxUploadBytes,
  );

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
        202: {
          description: "Content accepted for asynchronous ingestion",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(contentIngestionAcceptedSchema),
              ),
            },
          },
        },
        422: {
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
          ownerId: c.get("userId"),
          scrollPxPerSecond: payload.scrollPxPerSecond,
        });
        c.set("resourceId", result.content.id);
        c.set("fileId", result.content.id);
        c.header(
          "Location",
          `/api/v1/content-jobs/${encodeURIComponent(result.job.id)}`,
        );
        return c.json(toApiResponse(result), 202);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(ContentInUseError, conflict),
      mapErrorToResponse(InvalidContentTypeError, validationError),
    ),
  );

  router.post(
    "/flash",
    setAction("content.flash.create", {
      route: "/content/flash",
      resourceType: "content",
    }),
    requirePermission("content:create"),
    validateJson(createFlashContentSchema),
    describeRoute({
      description: "Create flash content",
      tags: contentTags,
      requestBody: {
        content: {
          "application/json": {
            schema: createFlashContentRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        201: {
          description: "Flash content created",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(contentSchema)),
            },
          },
        },
        422: {
          description: "Invalid request",
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
        const payload = c.req.valid("json");
        const created = await useCases.createFlashContent.execute({
          title: payload.title,
          message: payload.message,
          tone: payload.tone,
          ownerId: c.get("userId"),
        });
        c.set("resourceId", created.id);
        c.set("fileId", created.id);
        c.header("Location", `${c.req.path}/${encodeURIComponent(created.id)}`);
        return c.json(toApiResponse(created), 201);
      },
      ...applicationErrorMappers,
    ),
  );

  router.patch(
    "/:id{[0-9a-fA-F-]{36}}",
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
              schema: resolver(apiResponseSchema(contentSchema)),
            },
          },
        },
        422: {
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
          ownerId: c.get("userId"),
          title: body.title,
          flashMessage: body.flashMessage,
          flashTone: body.flashTone,
          scrollPxPerSecond: body.scrollPxPerSecond,
        });
        return c.json(toApiResponse(result), 200);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(ContentInUseError, conflict),
    ),
  );

  router.put(
    "/:id{[0-9a-fA-F-]{36}}/file",
    setAction("content.content.replace-file", {
      route: "/content/:id/file",
      resourceType: "content",
    }),
    requirePermission("content:update"),
    validateParams(contentIdParamSchema),
    bodyLimit({ maxSize: maxUploadBytes }),
    validateForm(replaceContentFileSchema),
    describeRoute({
      description: "Replace content file and metadata",
      tags: contentTags,
      requestBody: {
        content: {
          "multipart/form-data": {
            schema: replaceContentFileRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        202: {
          description:
            "Content replacement accepted for asynchronous ingestion",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(contentIngestionAcceptedSchema),
              ),
            },
          },
        },
        422: {
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
          description: "Conflict (content is currently in use)",
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
        const body = c.req.valid("form");
        c.set("resourceId", params.id);
        c.set("fileId", params.id);
        const result = await useCases.replaceContentFile.execute({
          id: params.id,
          ownerId: c.get("userId"),
          file: body.file,
          title: body.title,
        });
        c.header(
          "Location",
          `/api/v1/content-jobs/${encodeURIComponent(result.job.id)}`,
        );
        return c.json(toApiResponse(result), 202);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(ContentInUseError, conflict),
      mapErrorToResponse(InvalidContentTypeError, validationError),
    ),
  );

  router.patch(
    "/:id{[0-9a-fA-F-]{36}}/exclusion",
    setAction("content.content.set-exclusion", {
      route: "/content/:id/exclusion",
      resourceType: "content",
    }),
    requirePermission("content:update"),
    validateParams(contentIdParamSchema),
    validateJson(contentExclusionSchema),
    describeRoute({
      description: "Set global exclusion flag for a PDF page content item",
      tags: contentTags,
      requestBody: {
        content: {
          "application/json": {
            schema: contentExclusionRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Content exclusion updated",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(contentSchema)),
            },
          },
        },
        422: {
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
        const body = c.req.valid("json");
        c.set("resourceId", params.id);
        c.set("fileId", params.id);
        const result = await useCases.setContentExclusion.execute({
          id: params.id,
          ownerId: c.get("userId"),
          isExcluded: body.isExcluded,
        });
        return c.json(toApiResponse(result), 200);
      },
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/:id{[0-9a-fA-F-]{36}}",
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
        422: {
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
          description: "Content is in use by one or more playlists",
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
        await useCases.deleteContent.execute({
          id: params.id,
          ownerId: c.get("userId"),
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(ContentInUseError, conflict),
    ),
  );
};
