import { type OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";
import { isSupportedMimeType } from "#/domain/content/content";
import { apiListResponseSchema } from "#/interfaces/http/responses";

export const contentTypeSchema = z.enum(["IMAGE", "VIDEO", "FLASH", "TEXT"]);
export const contentStatusSchema = z.enum(["PROCESSING", "READY", "FAILED"]);
export const flashToneSchema = z.enum(["INFO", "WARNING", "CRITICAL"]);

export const contentSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: contentTypeSchema,
  status: contentStatusSchema,
  thumbnailUrl: z.string().url().optional(),
  mimeType: z.string(),
  fileSize: z.number().int(),
  checksum: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  duration: z.number().int().nullable(),
  flashMessage: z.string().nullable(),
  flashTone: flashToneSchema.nullable(),
  textJsonContent: z.string().nullable(),
  textHtmlContent: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  owner: z.object({
    id: z.string(),
    name: z.string(),
  }),
});

export const contentListResponseSchema = apiListResponseSchema(contentSchema);

export const contentIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const contentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: contentStatusSchema.optional(),
  type: contentTypeSchema.optional(),
  search: z.string().trim().min(1).max(255).optional(),
  sortBy: z
    .enum(["createdAt", "title", "fileSize", "type"])
    .default("createdAt"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});

export const contentOptionsQuerySchema = z.object({
  q: z.string().trim().min(1).max(255).optional(),
  status: contentStatusSchema.optional(),
  type: contentTypeSchema.optional(),
});

export const contentOptionSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: contentTypeSchema,
});

export const createFlashContentSchema = z.object({
  title: z.string().trim().min(1).max(255),
  message: z.string().trim().min(1).max(240),
  tone: flashToneSchema.default("INFO"),
});

export const createFlashContentRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 255 },
    message: { type: "string", minLength: 1, maxLength: 240 },
    tone: {
      type: "string",
      enum: ["INFO", "WARNING", "CRITICAL"],
    },
  },
  required: ["title", "message"],
  additionalProperties: false,
};

export const createTextContentSchema = z.object({
  title: z.string().trim().min(1).max(255),
  jsonContent: z.string().min(1),
  htmlContent: z.string().min(1),
});

export const createTextContentRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 255 },
    jsonContent: { type: "string", minLength: 1 },
    htmlContent: { type: "string", minLength: 1 },
  },
  required: ["title", "jsonContent", "htmlContent"],
  additionalProperties: false,
};

export const createUploadContentSchema = (
  maxBytes: number,
  videoMaxBytes: number,
) =>
  z.object({
    title: z.string().min(1),
    file: z
      .instanceof(File)
      .refine((file) => file.size > 0, "File is required")
      .refine((file) => isSupportedMimeType(file.type), "Unsupported file type")
      .refine((file) => file.size <= maxBytes, `File exceeds ${maxBytes} bytes`)
      .refine(
        (file) => file.type !== "video/mp4" || file.size <= videoMaxBytes,
        `Video files cannot exceed ${videoMaxBytes} bytes`,
      ),
  });

export const createReplaceContentFileSchema = (
  maxBytes: number,
  videoMaxBytes: number,
) =>
  z.object({
    file: z
      .instanceof(File)
      .refine((file) => file.size > 0, "File is required")
      .refine((file) => isSupportedMimeType(file.type), "Unsupported file type")
      .refine((file) => file.size <= maxBytes, `File exceeds ${maxBytes} bytes`)
      .refine(
        (file) => file.type !== "video/mp4" || file.size <= videoMaxBytes,
        `Video files cannot exceed ${videoMaxBytes} bytes`,
      ),
    title: z.string().min(1).optional(),
  });

export const downloadUrlResponseSchema = z.object({
  downloadUrl: z.string().url(),
});

export const updateContentSchema = z
  .object({
    title: z.string().min(1).optional(),
    flashMessage: z.string().trim().min(1).max(240).optional(),
    flashTone: flashToneSchema.optional(),
    textJsonContent: z.string().min(1).optional(),
    textHtmlContent: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.flashMessage !== undefined ||
      value.flashTone !== undefined ||
      value.textJsonContent !== undefined ||
      value.textHtmlContent !== undefined,
    "At least one field must be provided",
  );

export const updateContentRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1 },
    flashMessage: { type: "string", minLength: 1, maxLength: 240 },
    flashTone: {
      type: "string",
      enum: ["INFO", "WARNING", "CRITICAL"],
    },
    textJsonContent: { type: "string", minLength: 1 },
    textHtmlContent: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
};

export const contentUploadRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    title: { type: "string" },
    file: { type: "string", format: "binary" },
  },
  required: ["title", "file"],
};

export const replaceContentFileRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    file: { type: "string", format: "binary" },
    title: { type: "string", minLength: 1 },
  },
  required: ["file"],
  additionalProperties: false,
};

export const pdfCropUploadIdParamSchema = z.object({
  uploadId: z.string().uuid(),
});

export const cropRegionSchema = z.object({
  pageNumber: z.number().int().min(1),
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const submitPdfCropSchema = z.object({
  crops: z.array(cropRegionSchema).min(1).max(50),
  contentName: z.string().trim().min(1).max(255).optional(),
});

export const pdfCropPageInfoSchema = z.object({
  pageNumber: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
});

export const initPdfCropResponseSchema = z.object({
  uploadId: z.string().uuid(),
  filename: z.string(),
  pageCount: z.number().int(),
  pages: z.array(pdfCropPageInfoSchema),
});

export const submitPdfCropResponseSchema = z.object({
  items: z.array(contentSchema),
});

export const contentJobIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const contentJobStatusSchema = z.enum([
  "QUEUED",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
]);

export const contentJobOperationSchema = z.enum(["UPLOAD", "REPLACE"]);

export const contentJobSchema = z.object({
  id: z.string().uuid(),
  contentId: z.string().uuid(),
  operation: contentJobOperationSchema,
  status: contentJobStatusSchema,
  errorMessage: z.string().nullable(),
  ownerId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export const contentIngestionAcceptedSchema = z.object({
  content: contentSchema,
  job: contentJobSchema,
});
