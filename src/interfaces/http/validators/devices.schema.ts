import { type OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

export const deviceSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  name: z.string(),
  location: z.string().nullable(),
  ipAddress: z.string().nullable(),
  macAddress: z.string().nullable(),
  screenWidth: z.number().int().nullable(),
  screenHeight: z.number().int().nullable(),
  outputType: z.string().nullable(),
  orientation: z.enum(["LANDSCAPE", "PORTRAIT"]).nullable(),
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
  ipAddress: z.string().min(1).max(128).nullable().optional(),
  macAddress: z.string().min(1).max(64).nullable().optional(),
  screenWidth: z.number().int().positive().nullable().optional(),
  screenHeight: z.number().int().positive().nullable().optional(),
  outputType: z.string().min(1).max(64).nullable().optional(),
  orientation: z.enum(["LANDSCAPE", "PORTRAIT"]).nullable().optional(),
});

export const patchDeviceSchema = z.object({
  name: z.string().min(1).optional(),
  location: z.string().nullable().optional(),
  ipAddress: z.string().min(1).max(128).nullable().optional(),
  macAddress: z.string().min(1).max(64).nullable().optional(),
  screenWidth: z.number().int().positive().nullable().optional(),
  screenHeight: z.number().int().positive().nullable().optional(),
  outputType: z.string().min(1).max(64).nullable().optional(),
  orientation: z.enum(["LANDSCAPE", "PORTRAIT"]).nullable().optional(),
});

export const patchDeviceRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    name: { type: "string" },
    location: { oneOf: [{ type: "string" }, { type: "null" }] },
    ipAddress: { oneOf: [{ type: "string" }, { type: "null" }] },
    macAddress: { oneOf: [{ type: "string" }, { type: "null" }] },
    screenWidth: { oneOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
    screenHeight: {
      oneOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
    },
    outputType: { oneOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    orientation: {
      oneOf: [
        { type: "string", enum: ["LANDSCAPE", "PORTRAIT"] },
        { type: "null" },
      ],
    },
  },
};

export const registerDeviceRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    identifier: { type: "string" },
    name: { type: "string" },
    location: { oneOf: [{ type: "string" }, { type: "null" }] },
    ipAddress: { oneOf: [{ type: "string" }, { type: "null" }] },
    macAddress: { oneOf: [{ type: "string" }, { type: "null" }] },
    screenWidth: { oneOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
    screenHeight: {
      oneOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
    },
    outputType: { oneOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    orientation: {
      oneOf: [
        { type: "string", enum: ["LANDSCAPE", "PORTRAIT"] },
        { type: "null" },
      ],
    },
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
