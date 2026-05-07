import { type OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";
import { apiListResponseSchema } from "#/interfaces/http/responses";

export const displaySchema = z.object({
  id: z.string(),
  slug: z.string(),
  fingerprint: z.string().nullable().optional(),
  name: z.string(),
  output: z.string(),
  lastSeenAt: z.string().nullable(),
  status: z.enum(["PROCESSING", "READY", "LIVE", "DOWN"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const displayListResponseSchema = apiListResponseSchema(displaySchema);
export const displayListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().min(1).max(255).optional(),
  status: z.enum(["PROCESSING", "READY", "LIVE", "DOWN"]).optional(),
  output: z.string().trim().min(1).max(64).optional(),
  groupIds: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return Array.isArray(value) ? value : [value];
    }),
  groupNames: z
    .union([
      z.string().trim().min(1).max(120),
      z.array(z.string().trim().min(1).max(120)),
    ])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return Array.isArray(value) ? value : [value];
    }),
  sortBy: z.enum(["name", "status"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  membership: z.enum(["ungrouped", "any"]).optional(),
});

export const displayOptionsQuerySchema = z.object({
  q: z.string().trim().min(1).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(250).optional(),
});

export const displayOutputOptionsSchema = z.array(z.string());

export const displayIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const displaySlugParamSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export const displayGroupIdParamSchema = z.object({
  groupId: z.string().uuid(),
});

export const registerDisplaySchema = z.object({
  pairingCode: z.string().regex(/^\d{6}$/),
  slug: z.string().min(1),
  fingerprint: z.string().min(1).max(255).nullable().optional(),
  name: z.string().min(1),
  output: z.string().min(1).max(64),
});

export const patchDisplaySchema = z.object({
  name: z.string().min(1).optional(),
  output: z.string().min(1).max(64).optional(),
});

export const createDisplayGroupSchema = z.object({
  name: z.string().min(1).max(120),
});

export const updateDisplayGroupSchema = z.object({
  name: z.string().min(1).max(120).optional(),
});

export const setDisplayGroupsSchema = z.object({
  groupIds: z.array(z.string().uuid()).default([]),
});

export const displayGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  displayIds: z.array(z.string().uuid()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const displayGroupListResponseSchema =
  apiListResponseSchema(displayGroupSchema);

export const displayGroupListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().min(1).max(255).optional(),
  displayId: z.string().uuid().optional(),
  membership: z.enum(["member", "non-member"]).optional(),
});

export const resolveDisplayGroupsSchema = z.object({
  names: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
});

export const resolveDisplayGroupsRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    names: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 120 },
      minItems: 1,
      maxItems: 100,
    },
  },
  required: ["names"],
};

export const createDisplayGroupRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
  },
  required: ["name"],
};

export const updateDisplayGroupRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
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
    output: { type: "string", minLength: 1, maxLength: 64 },
  },
};

export const displayRuntimeOverridesSchema = z.object({
  globalEmergency: z.object({
    active: z.boolean(),
    startedAt: z.string().nullable(),
    activeSlotIndex: z.number().int().min(1).max(5).nullable(),
  }),
});

export const runtimeOverrideEmergencyActionSchema = z.object({
  active: z.boolean(),
  slotIndex: z.number().int().min(1).max(5).optional(),
  reason: z.string().trim().min(1).max(64).optional(),
});

export const runtimeOverrideEmergencyActionBodySchema: OpenAPIV3_1.SchemaObject =
  {
    type: "object",
    properties: {
      active: { type: "boolean" },
      slotIndex: { type: "integer", minimum: 1, maximum: 5 },
      reason: { type: "string", minLength: 1, maxLength: 64 },
    },
    required: ["active"],
    additionalProperties: false,
  };

export const registerDisplayRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    pairingCode: { type: "string", pattern: "^\\d{6}$" },
    slug: { type: "string" },
    fingerprint: { oneOf: [{ type: "string" }, { type: "null" }] },
    name: { type: "string" },
    output: { type: "string", minLength: 1, maxLength: 64 },
  },
  required: ["pairingCode", "slug", "name", "output"],
};

export const registrationCodeResponseSchema = z.object({
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
  loop: z.boolean(),
  content: z.object({
    id: z.string(),
    type: z.enum(["IMAGE", "VIDEO", "TEXT"]),
    checksum: z.string(),
    downloadUrl: z.string().url().or(z.literal("")),
    thumbnailUrl: z.string().url().nullable().optional(),
    mimeType: z.string(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    duration: z.number().int().nullable(),
    textHtmlContent: z.string().nullable(),
  }),
});

export const manifestScheduleWindowSchema = z.object({
  id: z.string(),
  kind: z.enum(["PLAYLIST", "FLASH"]),
  startTime: z.string(),
  endTime: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
});

export const displayManifestSchema = z.object({
  playlistId: z.string().nullable(),
  playlistVersion: z.string(),
  generatedAt: z.string(),
  playback: z.object({
    mode: z.enum(["SCHEDULE", "EMERGENCY"]),
    emergency: z
      .object({
        source: z.literal("SLOT"),
        startedAt: z.string().nullable(),
        isGlobal: z.boolean(),
        content: z.object({
          id: z.string(),
          type: z.enum(["IMAGE", "VIDEO"]),
          checksum: z.string(),
          downloadUrl: z.string().url(),
          thumbnailUrl: z.string().url().nullable().optional(),
          mimeType: z.string(),
          width: z.number().int().nullable(),
          height: z.number().int().nullable(),
          duration: z.number().int().nullable(),
          textHtmlContent: z.string().nullable(),
        }),
      })
      .nullable(),
    flash: z
      .object({
        scheduleId: z.string().uuid(),
        contentId: z.string().uuid(),
        message: z.string(),
        tone: z.enum(["INFO", "WARNING", "CRITICAL"]),
        region: z.literal("TOP_TICKER"),
        heightPx: z.number().int().positive(),
        speedPxPerSecond: z.number().int().positive(),
      })
      .nullable(),
  }),
  items: z.array(displayManifestItemSchema),
  schedules: z.array(manifestScheduleWindowSchema),
});
