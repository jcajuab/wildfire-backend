import { z } from "zod";

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

export const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().trim().optional().nullable(),
});

export const setRolePermissionsSchema = z.object({
  permissionIds: z.array(z.string().uuid()).default([]),
});

export const createUserSchema = z.object({
  username: z.string().trim().min(1).max(120),
  email: z.string().email().optional().nullable(),
  name: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const userListQuerySchema = baseListQuerySchema;

export const updateUserSchema = z.object({
  username: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().optional().nullable(),
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export const setUserRolesSchema = z.object({
  roleIds: z.array(z.string().uuid()).default([]),
});

export const permissionListQuerySchema = baseListQuerySchema;
