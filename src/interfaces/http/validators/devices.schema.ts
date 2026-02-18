import { type OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

export const deviceSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  name: z.string(),
  location: z.string().nullable(),
  lastSeenAt: z.string(),
  onlineStatus: z.enum(["LIVE", "DOWN"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const deviceListResponseSchema = z.object({
  items: z.array(deviceSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export const deviceIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const registerDeviceSchema = z.object({
  identifier: z.string().min(1),
  name: z.string().min(1),
  location: z.string().nullable().optional(),
});

export const registerDeviceRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    identifier: { type: "string" },
    name: { type: "string" },
    location: { oneOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["identifier", "name"],
};

export const deviceManifestItemSchema = z.object({
  id: z.string(),
  sequence: z.number().int(),
  duration: z.number().int(),
  content: z.object({
    id: z.string(),
    type: z.enum(["IMAGE", "VIDEO", "PDF"]),
    checksum: z.string(),
    downloadUrl: z.string().url(),
    mimeType: z.string(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    duration: z.number().int().nullable(),
  }),
});

export const deviceManifestSchema = z.object({
  playlistId: z.string().nullable(),
  playlistVersion: z.string(),
  generatedAt: z.string(),
  items: z.array(deviceManifestItemSchema),
});
