import { z } from "zod";

export const createRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().trim().optional().nullable(),
});

export const roleIdParamSchema = z.object({
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

export const updateUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export const setUserRolesSchema = z.object({
  roleIds: z.array(z.string()).default([]),
  policyVersion: z.number().int().positive().optional(),
});
