import { z } from "zod";

export const playlistSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(["DRAFT", "IN_USE"]),
  itemsCount: z.number().int(),
  totalDuration: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.object({
    id: z.string(),
    name: z.string().nullable(),
  }),
});

export const playlistItemSchema = z.object({
  id: z.string(),
  sequence: z.number().int(),
  duration: z.number().int(),
  content: z.object({
    id: z.string(),
    title: z.string(),
    type: z.enum(["IMAGE", "VIDEO", "PDF"]),
    checksum: z.string(),
  }),
});

export const playlistWithItemsSchema = playlistSchema.extend({
  items: z.array(playlistItemSchema),
});

export const playlistListResponseSchema = z.object({
  items: z.array(playlistSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export const playlistListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["DRAFT", "IN_USE"]).optional(),
  search: z.string().trim().min(1).max(255).optional(),
  sortBy: z.enum(["updatedAt", "name"]).default("updatedAt"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});

export const playlistIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const playlistItemIdParamSchema = z.object({
  itemId: z.string().uuid(),
});

export const playlistItemParamSchema = playlistIdParamSchema.merge(
  playlistItemIdParamSchema,
);

export const createPlaylistSchema = z.object({
  name: z.string().min(1),
  description: z.string().trim().optional().nullable(),
});

export const updatePlaylistSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().trim().optional().nullable(),
});

export const addPlaylistItemSchema = z.object({
  contentId: z.string().uuid(),
  sequence: z.number().int(),
  duration: z.number().int(),
});

export const updatePlaylistItemSchema = z.object({
  sequence: z.number().int().optional(),
  duration: z.number().int().optional(),
});
