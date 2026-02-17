import { type OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";
import { isSupportedMimeType } from "#/domain/content/content";

export const contentTypeSchema = z.enum(["IMAGE", "VIDEO", "PDF"]);

export const contentSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: contentTypeSchema,
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

export const contentListResponseSchema = z.object({
  items: z.array(contentSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const contentIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const contentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
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

export const downloadUrlResponseSchema = z.object({
  downloadUrl: z.string().url(),
});

export const updateContentSchema = z.object({
  title: z.string().min(1),
});

export const contentUploadRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    title: { type: "string" },
    file: { type: "string", format: "binary" },
  },
  required: ["title", "file"],
};
