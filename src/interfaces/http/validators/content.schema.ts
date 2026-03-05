import { type OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";
import { isSupportedMimeType } from "#/domain/content/content";
import { apiListResponseSchema } from "#/interfaces/http/responses";

export const contentTypeSchema = z.enum(["IMAGE", "VIDEO", "PDF", "FLASH"]);
export const contentKindSchema = z.enum(["ROOT", "PAGE"]);
export const contentStatusSchema = z.enum(["PROCESSING", "READY", "FAILED"]);
export const flashToneSchema = z.enum(["INFO", "WARNING", "CRITICAL"]);

export const contentSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: contentTypeSchema,
  kind: contentKindSchema,
  status: contentStatusSchema,
  thumbnailUrl: z.string().url().optional(),
  mimeType: z.string(),
  fileSize: z.number().int(),
  checksum: z.string(),
  parentContentId: z.string().uuid().nullable(),
  pageNumber: z.number().int().nullable(),
  pageCount: z.number().int().nullable(),
  isExcluded: z.boolean(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  duration: z.number().int().nullable(),
  flashMessage: z.string().nullable(),
  flashTone: flashToneSchema.nullable(),
  createdAt: z.string(),
  createdBy: z.object({
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
  parentId: z.string().uuid().optional(),
  status: contentStatusSchema.optional(),
  type: contentTypeSchema.optional(),
  search: z.string().trim().min(1).max(255).optional(),
  sortBy: z
    .enum(["createdAt", "title", "fileSize", "type", "pageNumber"])
    .default("createdAt"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});

export const flashActivationStatusSchema = z.enum([
  "ACTIVE",
  "STOPPED",
  "EXPIRED",
]);

export const flashActivationSchema = z.object({
  id: z.string().uuid(),
  contentId: z.string().uuid(),
  targetDisplayId: z.string().uuid(),
  message: z.string(),
  tone: flashToneSchema,
  status: flashActivationStatusSchema,
  startedAt: z.string(),
  endsAt: z.string(),
  stoppedAt: z.string().nullable(),
  stoppedReason: z.string().nullable(),
  createdById: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  replacementCount: z.number().int().nonnegative(),
});

export const createFlashActivationSchema = z.object({
  message: z.string().trim().min(1).max(240),
  targetDisplayId: z.string().uuid(),
  durationSeconds: z.number().int().min(5).max(600).default(60),
  tone: flashToneSchema.default("INFO"),
  conflictDecision: z.enum(["prompt", "replace", "keep"]).optional(),
  expectedActiveActivationId: z.string().uuid().optional(),
});

export const createFlashActivationRequestBodySchema: OpenAPIV3_1.SchemaObject =
  {
    type: "object",
    properties: {
      message: { type: "string", minLength: 1, maxLength: 240 },
      targetDisplayId: { type: "string", format: "uuid" },
      durationSeconds: { type: "integer", minimum: 5, maximum: 600 },
      tone: {
        type: "string",
        enum: ["INFO", "WARNING", "CRITICAL"],
      },
      conflictDecision: {
        type: "string",
        enum: ["prompt", "replace", "keep"],
      },
      expectedActiveActivationId: { type: "string", format: "uuid" },
    },
    required: ["message", "targetDisplayId"],
    additionalProperties: false,
  };

export const flashActivationCreateResponseSchema = z.object({
  content: contentSchema,
  activation: flashActivationSchema,
  replacedActivation: flashActivationSchema.nullable().optional(),
});

export const flashActivationConflictSchema = z.object({
  active: flashActivationSchema,
  pending: z.object({
    message: z.string(),
    targetDisplayId: z.string().uuid(),
    durationSeconds: z.number().int(),
    tone: flashToneSchema,
  }),
});

export const stopFlashActivationSchema = z.object({
  reason: z.string().trim().min(1).max(64).optional(),
});

export const stopFlashActivationRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    reason: { type: "string", minLength: 1, maxLength: 64 },
  },
  additionalProperties: false,
};

export const createUploadContentSchema = (maxBytes: number) =>
  z.object({
    title: z.string().min(1),
    file: z
      .instanceof(File)
      .refine((file) => file.size > 0, "File is required")
      .refine((file) => isSupportedMimeType(file.type), "Unsupported file type")
      .refine(
        (file) => file.size <= maxBytes,
        `File exceeds ${maxBytes} bytes`,
      ),
  });

export const createReplaceContentFileSchema = (maxBytes: number) =>
  z.object({
    file: z
      .instanceof(File)
      .refine((file) => file.size > 0, "File is required")
      .refine((file) => isSupportedMimeType(file.type), "Unsupported file type")
      .refine(
        (file) => file.size <= maxBytes,
        `File exceeds ${maxBytes} bytes`,
      ),
    title: z.string().min(1).optional(),
  });

export const downloadUrlResponseSchema = z.object({
  downloadUrl: z.string().url(),
});

export const updateContentSchema = z.object({
  title: z.string().min(1),
});

export const updateContentRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1 },
  },
  required: ["title"],
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
  createdById: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export const contentIngestionAcceptedSchema = z.object({
  content: contentSchema,
  job: contentJobSchema,
});

export const contentExclusionSchema = z.object({
  isExcluded: z.boolean(),
});

export const contentExclusionRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    isExcluded: { type: "boolean" },
  },
  required: ["isExcluded"],
  additionalProperties: false,
};
