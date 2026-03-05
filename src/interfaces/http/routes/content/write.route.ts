import { bodyLimit } from "hono/body-limit";
import { describeRoute, resolver } from "hono-openapi";
import {
  ContentInUseError,
  FlashActivationConflictError,
  InvalidContentTypeError,
} from "#/application/use-cases/content";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  conflict,
  errorResponseSchema,
  notFound,
  type ResponseContext,
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
  createFlashActivationRequestBodySchema,
  createFlashActivationSchema,
  createReplaceContentFileSchema,
  createUploadContentSchema,
  flashActivationConflictSchema,
  flashActivationCreateResponseSchema,
  flashActivationSchema,
  replaceContentFileRequestBodySchema,
  stopFlashActivationRequestBodySchema,
  stopFlashActivationSchema,
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
  const replaceContentFileSchema =
    createReplaceContentFileSchema(maxUploadBytes);
  const mapFlashConflictToResponse = (
    c: ResponseContext,
    error: unknown,
  ): Response | null => {
    if (!(error instanceof FlashActivationConflictError)) {
      return null;
    }
    return c.json(toApiResponse(error.details), 409);
  };

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
          createdById: c.get("userId"),
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
    "/flash/activate",
    setAction("content.flash.activate", {
      route: "/content/flash/activate",
      resourceType: "content",
    }),
    requirePermission("content:update"),
    validateJson(createFlashActivationSchema),
    describeRoute({
      description: "Activate flash marquee overlay for a target display",
      tags: contentTags,
      requestBody: {
        content: {
          "application/json": {
            schema: createFlashActivationRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Flash content activated",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(flashActivationCreateResponseSchema),
              ),
            },
          },
        },
        409: {
          description: "A flash activation is already active",
          content: {
            "application/json": {
              schema: resolver(
                apiResponseSchema(flashActivationConflictSchema),
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
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const activated = await useCases.createFlashActivation.execute({
          message: payload.message,
          targetDisplayId: payload.targetDisplayId,
          durationSeconds: payload.durationSeconds,
          tone: payload.tone,
          conflictDecision: payload.conflictDecision,
          expectedActiveActivationId: payload.expectedActiveActivationId,
          createdById: c.get("userId"),
        });
        return c.json(toApiResponse(activated));
      },
      mapFlashConflictToResponse,
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/flash/active/stop",
    setAction("content.flash.stop", {
      route: "/content/flash/active/stop",
      resourceType: "content",
    }),
    requirePermission("content:update"),
    validateJson(stopFlashActivationSchema),
    describeRoute({
      description: "Stop the active flash marquee overlay",
      tags: contentTags,
      requestBody: {
        content: {
          "application/json": {
            schema: stopFlashActivationRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Flash content stopped",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(flashActivationSchema)),
            },
          },
        },
        404: {
          description: "No active flash content",
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
        const stopped = await useCases.stopFlashActivation.execute({
          reason: payload.reason,
        });
        if (!stopped || stopped.status !== "STOPPED") {
          return notFound(c, "No active flash content");
        }
        return c.json(toApiResponse(stopped));
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
          title: body.title,
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
        await useCases.deleteContent.execute({ id: params.id });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
      mapErrorToResponse(ContentInUseError, conflict),
    ),
  );
};
