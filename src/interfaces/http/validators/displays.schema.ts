import { type OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";
import { apiListResponseSchema } from "#/interfaces/http/responses";

export const displaySchema = z.object({
  id: z.string(),
  identifier: z.string(),
  displayFingerprint: z.string().nullable().optional(),
  name: z.string(),
  location: z.string().nullable(),
  ipAddress: z.string().nullable(),
  macAddress: z.string().nullable(),
  screenWidth: z.number().int().nullable(),
  screenHeight: z.number().int().nullable(),
  outputType: z.string().nullable(),
  orientation: z.enum(["LANDSCAPE", "PORTRAIT"]).nullable(),
  lastSeenAt: z.string().nullable(),
  onlineStatus: z.enum(["READY", "LIVE", "DOWN"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const displayListResponseSchema = apiListResponseSchema(displaySchema);
export const displayListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const displayIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const displayGroupIdParamSchema = z.object({
  groupId: z.string().uuid(),
});

export const registerDisplaySchema = z.object({
  pairingCode: z.string().regex(/^\d{6}$/),
  identifier: z.string().min(1),
  displayFingerprint: z.string().min(1).max(255).nullable().optional(),
  name: z.string().min(1),
  location: z.string().nullable().optional(),
  ipAddress: z.string().min(1).max(128).nullable().optional(),
  macAddress: z.string().min(1).max(64).nullable().optional(),
  screenWidth: z.number().int().positive(),
  screenHeight: z.number().int().positive(),
  outputType: z.string().min(1).max(64).nullable().optional(),
  orientation: z.enum(["LANDSCAPE", "PORTRAIT"]).nullable().optional(),
});

export const patchDisplaySchema = z.object({
  name: z.string().min(1).optional(),
  location: z.string().nullable().optional(),
  ipAddress: z.string().min(1).max(128).nullable().optional(),
  macAddress: z.string().min(1).max(64).nullable().optional(),
  screenWidth: z.number().int().positive().nullable().optional(),
  screenHeight: z.number().int().positive().nullable().optional(),
  outputType: z.string().min(1).max(64).nullable().optional(),
  orientation: z.enum(["LANDSCAPE", "PORTRAIT"]).nullable().optional(),
});

export const createDisplayGroupSchema = z.object({
  name: z.string().min(1).max(120),
  colorIndex: z.number().int().min(0).optional(),
});

export const updateDisplayGroupSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  colorIndex: z.number().int().min(0).optional(),
});

export const setDisplayGroupsSchema = z.object({
  groupIds: z.array(z.string().uuid()).default([]),
});

export const displayGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  colorIndex: z.number().int().nonnegative(),
  displayIds: z.array(z.string().uuid()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const displayGroupListResponseSchema =
  apiListResponseSchema(displayGroupSchema);

export const createDisplayGroupRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    colorIndex: { type: "integer", minimum: 0 },
  },
  required: ["name"],
};

export const updateDisplayGroupRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    colorIndex: { type: "integer", minimum: 0 },
  },
};

export const setDisplayGroupsRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    groupIds: {
      type: "array",
      items: { type: "string", format: "uuid" },
    },
  },
  required: ["groupIds"],
};

export const patchDisplayRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    name: { type: "string" },
    location: { oneOf: [{ type: "string" }, { type: "null" }] },
    ipAddress: { oneOf: [{ type: "string" }, { type: "null" }] },
    macAddress: { oneOf: [{ type: "string" }, { type: "null" }] },
    screenWidth: { type: "integer", minimum: 1 },
    screenHeight: { type: "integer", minimum: 1 },
    outputType: { oneOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    orientation: {
      oneOf: [
        { type: "string", enum: ["LANDSCAPE", "PORTRAIT"] },
        { type: "null" },
      ],
    },
  },
};

export const registerDisplayRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    pairingCode: { type: "string", pattern: "^\\d{6}$" },
    identifier: { type: "string" },
    displayFingerprint: { oneOf: [{ type: "string" }, { type: "null" }] },
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
  required: [
    "pairingCode",
    "identifier",
    "name",
    "screenWidth",
    "screenHeight",
  ],
};

export const pairingCodeResponseSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  expiresAt: z.string(),
});

export const displayStreamTokenResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string(),
});

export const displayStreamQuerySchema = z.object({
  streamToken: z.string().min(1),
});

export const displayManifestItemSchema = z.object({
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

export const displayManifestSchema = z.object({
  playlistId: z.string().nullable(),
  playlistVersion: z.string(),
  generatedAt: z.string(),
  runtimeSettings: z.object({
    scrollPxPerSecond: z.number().int().positive(),
  }),
  items: z.array(displayManifestItemSchema),
});
