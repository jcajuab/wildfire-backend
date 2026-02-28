import { z } from "zod";

export const scheduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  playlistId: z.string(),
  displayId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  priority: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  playlist: z.object({
    id: z.string(),
    name: z.string().nullable(),
  }),
  display: z.object({
    id: z.string(),
    name: z.string().nullable(),
  }),
});

export const scheduleListResponseSchema = z.object({
  items: z.array(scheduleSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export const scheduleItemsResponseSchema = z.object({
  items: z.array(scheduleSchema),
});

export const scheduleIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const createScheduleSchema = z.object({
  name: z.string().min(1),
  playlistId: z.string().uuid(),
  displayId: z.string().uuid(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  priority: z.number().int(),
  isActive: z.boolean().optional().default(true),
});

export const updateScheduleSchema = z.object({
  name: z.string().min(1).optional(),
  playlistId: z.string().uuid().optional(),
  displayId: z.string().uuid().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
