import { bodyLimit } from "hono/body-limit";
import { describeRoute, resolver } from "hono-openapi";
import {
  type CancelPdfCropUseCase,
  type InitPdfCropUseCase,
  type SubmitPdfCropUseCase,
} from "#/application/use-cases/content";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  errorResponseSchema,
  toApiResponse,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { authValidationErrorResponses } from "#/interfaces/http/routes/shared/openapi-responses";
import {
  initPdfCropResponseSchema,
  pdfCropUploadIdParamSchema,
  submitPdfCropResponseSchema,
  submitPdfCropSchema,
} from "#/interfaces/http/validators/content.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";
import {
  type ContentRouter,
  contentTags,
  type RequirePermission,
} from "./shared";

export const registerPdfCropRoutes = (args: {
  router: ContentRouter;
  useCases: {
    initPdfCrop: InitPdfCropUseCase;
    submitPdfCrop: SubmitPdfCropUseCase;
    cancelPdfCrop: CancelPdfCropUseCase;
  };
  requirePermission: RequirePermission;
  maxUploadBytes: number;
}) => {
  const { router, useCases, requirePermission, maxUploadBytes } = args;

  router.post(
    "/pdf-crop",
    setAction("content.pdf-crop.init", {
      route: "/content/pdf-crop",
      resourceType: "content",
    }),
    requirePermission("content:create"),
    bodyLimit({ maxSize: maxUploadBytes }),
    describeRoute({
      description:
        "Upload a PDF and extract page metadata for crop selection. Returns page dimensions.",
      tags: contentTags,
      requestBody: {
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: {
                file: { type: "string", format: "binary" },
              },
              required: ["file"],
            },
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "PDF uploaded and pages extracted",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(initPdfCropResponseSchema)),
            },
          },
        },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const form = await c.req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          return c.json(
            {
              error: {
                code: "validation_error",
                message: "file is required",
                requestId: c.get("requestId"),
              },
            },
            422,
          );
        }
        const result = await useCases.initPdfCrop.execute({
          file,
          ownerId: c.get("userId"),
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/pdf-crop/submit",
    setAction("content.pdf-crop.submit", {
      route: "/content/pdf-crop/submit",
      resourceType: "content",
    }),
    requirePermission("content:create"),
    validateJson(submitPdfCropSchema),
    describeRoute({
      description:
        "Submit crop regions for a previously uploaded PDF. Creates IMAGE content items for each crop.",
      tags: contentTags,
      responses: {
        201: {
          description: "Cropped image content items created",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(submitPdfCropResponseSchema)),
            },
          },
        },
        404: {
          description: "Crop session not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const body = c.req.valid("json");
        const result = await useCases.submitPdfCrop.execute({
          uploadId: body.uploadId,
          crops: body.crops,
          ownerId: c.get("userId"),
        });
        return c.json(toApiResponse(result), 201);
      },
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/pdf-crop/:uploadId{[0-9a-fA-F-]{36}}",
    setAction("content.pdf-crop.cancel", {
      route: "/content/pdf-crop/:uploadId",
      resourceType: "content",
    }),
    requirePermission("content:create"),
    validateParams(pdfCropUploadIdParamSchema),
    describeRoute({
      description: "Cancel a PDF crop session and delete the temporary PDF.",
      tags: contentTags,
      responses: {
        204: { description: "Session cancelled" },
        404: {
          description: "Crop session not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        await useCases.cancelPdfCrop.execute({
          uploadId: params.uploadId,
          ownerId: c.get("userId"),
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
