import { type OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";
import {
  apiListResponseSchema,
  apiResponseSchema,
} from "#/interfaces/http/responses";

export const auditActorTypeSchema = z.enum(["user", "display"]);

export const auditLogSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  requestId: z.string().nullable(),
  action: z.string(),
  route: z.string().nullable(),
  method: z.string(),
  path: z.string(),
  status: z.number().int(),
  actorId: z.string().nullable(),
  actorType: auditActorTypeSchema.nullable(),
  resourceId: z.string().nullable(),
  resourceType: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  metadataJson: z.string().nullable(),
  actorName: z.string().nullable().optional(),
  actorEmail: z.string().nullable().optional(),
});

export const auditLogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  q: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  actorId: z.string().min(1).optional(),
  actorType: auditActorTypeSchema.optional(),
  action: z.string().min(1).optional(),
  resourceType: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  status: z.coerce.number().int().min(100).max(599).optional(),
  requestId: z.string().min(1).optional(),
});

export const auditLogExportQuerySchema = auditLogListQuerySchema.omit({
  page: true,
  pageSize: true,
});

export const auditLogListResponseSchema = apiListResponseSchema(auditLogSchema);

export const auditLogFlushRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("olderThanDays"),
    days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  }),
  z.object({
    mode: z.literal("beforeDate"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    mode: z.literal("all"),
  }),
]);

export const auditLogFlushRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  oneOf: [
    {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["olderThanDays"] },
        days: { type: "integer", enum: [7, 30, 90] },
      },
      required: ["mode", "days"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["beforeDate"] },
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
      },
      required: ["mode", "date"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["all"] },
      },
      required: ["mode"],
      additionalProperties: false,
    },
  ],
};

export const auditLogFlushResponseSchema = apiResponseSchema(
  z.object({
    deleted: z.number().int().nonnegative(),
  }),
);
