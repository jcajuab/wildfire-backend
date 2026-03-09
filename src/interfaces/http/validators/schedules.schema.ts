import { z } from "zod";
import {
  apiListResponseSchema,
  apiResponseSchema,
} from "#/interfaces/http/responses";

export const scheduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["PLAYLIST", "FLASH"]),
  playlistId: z.string().nullable(),
  contentId: z.string().nullable(),
  displayId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  playlist: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
    })
    .nullable(),
  content: z
    .object({
      id: z.string(),
      title: z.string().nullable(),
      type: z.enum(["FLASH"]),
      flashMessage: z.string().nullable(),
      flashTone: z.enum(["INFO", "WARNING", "CRITICAL"]).nullable(),
    })
    .nullable(),
  display: z.object({
    id: z.string(),
    name: z.string().nullable(),
  }),
});

export const scheduleListResponseSchema = apiListResponseSchema(scheduleSchema);
export const scheduleListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const scheduleWindowQuerySchema = z
  .object({
    from: z.string().date(),
    to: z.string().date(),
    displayIds: z
      .union([z.string().uuid(), z.array(z.string().uuid())])
      .optional()
      .transform((value) => {
        if (value === undefined) return undefined;
        return Array.isArray(value) ? value : [value];
      }),
  })
  .refine((value) => value.from <= value.to, {
    message: "`from` must be on or before `to`",
    path: ["to"],
  });

export const scheduleResponseSchema = apiResponseSchema(scheduleSchema);

export const scheduleIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const createScheduleSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(["PLAYLIST", "FLASH"]),
  playlistId: z.string().uuid().nullable(),
  contentId: z.string().uuid().nullable(),
  displayId: z.string().uuid(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  isActive: z.boolean().optional().default(true),
});

export const updateScheduleSchema = z.object({
  name: z.string().trim().min(1).optional(),
  kind: z.enum(["PLAYLIST", "FLASH"]).optional(),
  playlistId: z.string().uuid().nullable().optional(),
  contentId: z.string().uuid().nullable().optional(),
  displayId: z.string().uuid().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});
