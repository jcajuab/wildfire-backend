import { z } from "zod";
import { apiListResponseSchema } from "#/interfaces/http/responses";

export const auditActorTypeSchema = z.enum(["user", "display"]);

export const auditEventSchema = z.object({
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

export const auditEventListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
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

export const auditEventExportQuerySchema = auditEventListQuerySchema.omit({
  page: true,
  pageSize: true,
});

export const auditEventListResponseSchema =
  apiListResponseSchema(auditEventSchema);
