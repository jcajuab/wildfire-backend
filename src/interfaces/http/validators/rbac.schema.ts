import { z } from "zod";
import { apiListResponseSchema } from "#/interfaces/http/responses";

const baseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const createRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().trim().optional().nullable(),
});

export const roleIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const roleListQuerySchema = baseListQuerySchema;
export const rolePermissionsListQuerySchema = baseListQuerySchema;

export const roleDeletionRequestIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().trim().optional().nullable(),
});

export const setRolePermissionsSchema = z.object({
  permissionIds: z.array(z.string()).default([]),
  policyVersion: z.number().int().positive().optional(),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid(),
});
export const userListQuerySchema = baseListQuerySchema;

export const updateUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export const setUserRolesSchema = z.object({
  roleIds: z.array(z.string()).default([]),
  policyVersion: z.number().int().positive().optional(),
});
export const permissionListQuerySchema = baseListQuerySchema;

export const policyHistoryChangeTypeSchema = z.enum([
  "role_permissions",
  "user_roles",
]);

export const policyHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  policyVersion: z.coerce.number().int().positive().optional(),
  changeType: policyHistoryChangeTypeSchema.optional(),
  targetId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const policyHistoryRecordSchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string(),
  policyVersion: z.number().int().positive(),
  changeType: policyHistoryChangeTypeSchema,
  targetId: z.string().uuid(),
  targetType: z.enum(["role", "user"]),
  actorId: z.string().uuid().nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  requestId: z.string().nullable(),
  targetCount: z.number().int().nonnegative(),
  addedCount: z.number().int().nonnegative(),
  removedCount: z.number().int().nonnegative(),
});

export const policyHistoryListResponseSchema = apiListResponseSchema(
  policyHistoryRecordSchema,
);

export const createRoleDeletionRequestSchema = z.object({
  reason: z.string().trim().max(1024).optional(),
});

export const rejectRoleDeletionRequestSchema = z.object({
  reason: z.string().trim().max(1024).optional(),
});

export const roleDeletionRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const roleDeletionRequestListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: roleDeletionRequestStatusSchema.optional(),
  roleId: z.string().uuid().optional(),
});

export const roleDeletionRequestRecordSchema = z.object({
  id: z.string().uuid(),
  roleId: z.string().uuid(),
  roleName: z.string(),
  requestedByUserId: z.string().uuid(),
  requestedByName: z.string(),
  requestedByEmail: z.string().email(),
  requestedAt: z.string(),
  status: roleDeletionRequestStatusSchema,
  approvedByUserId: z.string().uuid().nullable(),
  approvedByName: z.string().nullable(),
  approvedByEmail: z.string().email().nullable(),
  approvedAt: z.string().nullable(),
  reason: z.string().nullable(),
});

export const roleDeletionRequestListResponseSchema = apiListResponseSchema(
  roleDeletionRequestRecordSchema,
);
