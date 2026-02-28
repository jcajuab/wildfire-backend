import { type OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";
import { isSupportedMimeType } from "#/domain/content/content";
import { apiListResponseSchema } from "#/interfaces/http/responses";

export const contentTypeSchema = z.enum(["IMAGE", "VIDEO", "PDF"]);
export const contentStatusSchema = z.enum(["DRAFT", "IN_USE"]);

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
  status: contentStatusSchema.optional(),
  type: contentTypeSchema.optional(),
  search: z.string().trim().min(1).max(255).optional(),
  sortBy: z
    .enum(["createdAt", "title", "fileSize", "type"])
    .default("createdAt"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});

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
    status: contentStatusSchema.optional(),
  });

export const downloadUrlResponseSchema = z.object({
  downloadUrl: z.string().url(),
});

export const updateContentSchema = z
  .object({
    title: z.string().min(1).optional(),
    status: contentStatusSchema.optional(),
  })
  .refine((value) => value.title !== undefined || value.status !== undefined, {
    message: "At least one field must be provided",
  });

export const updateContentRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["DRAFT", "IN_USE"] },
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
    status: { type: "string", enum: ["DRAFT", "IN_USE"] },
  },
  required: ["file"],
  additionalProperties: false,
};
