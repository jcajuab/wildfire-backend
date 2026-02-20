import { z } from "zod";

export const scheduleSchema = z.object({
  id: z.string(),
  seriesId: z.string().uuid(),
  name: z.string(),
  playlistId: z.string(),
  deviceId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  dayOfWeek: z.number().int().min(0).max(6),
  priority: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  playlist: z.object({
    id: z.string(),
    name: z.string().nullable(),
  }),
  device: z.object({
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

export const scheduleSeriesIdParamSchema = z.object({
  seriesId: z.string().uuid(),
});

export const createScheduleSchema = z.object({
  name: z.string().min(1),
  playlistId: z.string().uuid(),
  deviceId: z.string().uuid(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  daysOfWeek: z.array(z.number().int()).min(1),
  priority: z.number().int(),
  isActive: z.boolean().optional().default(true),
});

export const updateScheduleSchema = z.object({
  name: z.string().min(1).optional(),
  playlistId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const updateScheduleSeriesSchema = z.object({
  name: z.string().min(1).optional(),
  playlistId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
