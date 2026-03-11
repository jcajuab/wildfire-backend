import { z } from "zod";

export const AI_TOOLS = {
  create_text_content: {
    name: "create_text_content",
    description: "Create text-based content with rich text formatting",
    parameters: z.object({
      title: z.string().min(1).describe("Content title"),
      jsonContent: z.string().min(1).describe("TipTap JSON content structure"),
      htmlContent: z
        .string()
        .min(1)
        .describe("HTML representation of the content"),
    }),
    requiresConfirmation: false,
  },

  create_playlist: {
    name: "create_playlist",
    description: "Create a new playlist for organizing content",
    parameters: z.object({
      name: z.string().min(1).describe("Playlist name"),
      description: z.string().optional().describe("Playlist description"),
    }),
    requiresConfirmation: false,
  },

  create_schedule: {
    name: "create_schedule",
    description: "Create a schedule to display content on a specific display",
    parameters: z.object({
      name: z.string().min(1).describe("Schedule name"),
      kind: z.enum(["PLAYLIST", "FLASH"]).describe("Schedule type"),
      playlistId: z
        .string()
        .uuid()
        .optional()
        .describe("Playlist ID (required for PLAYLIST kind)"),
      contentId: z
        .string()
        .uuid()
        .optional()
        .describe("Content ID (required for FLASH kind)"),
      displayId: z.string().uuid().describe("Target display ID"),
      startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
      startTime: z.string().describe("Start time (HH:MM)"),
      endTime: z.string().describe("End time (HH:MM)"),
      isActive: z
        .boolean()
        .default(true)
        .describe("Whether schedule is active"),
    }),
    requiresConfirmation: false,
  },

  edit_content: {
    name: "edit_content",
    description: "Edit existing content (requires user confirmation)",
    parameters: z.object({
      contentId: z.string().uuid(),
      title: z.string().optional(),
      jsonContent: z.string().optional(),
      htmlContent: z.string().optional(),
    }),
    requiresConfirmation: true,
  },

  delete_content: {
    name: "delete_content",
    description: "Delete content (requires user confirmation)",
    parameters: z.object({
      contentId: z.string().uuid(),
    }),
    requiresConfirmation: true,
  },

  edit_playlist: {
    name: "edit_playlist",
    description: "Edit existing playlist (requires user confirmation)",
    parameters: z.object({
      playlistId: z.string().uuid(),
      name: z.string().optional(),
      description: z.string().optional(),
    }),
    requiresConfirmation: true,
  },

  delete_playlist: {
    name: "delete_playlist",
    description: "Delete playlist (requires user confirmation)",
    parameters: z.object({
      playlistId: z.string().uuid(),
    }),
    requiresConfirmation: true,
  },

  edit_schedule: {
    name: "edit_schedule",
    description: "Edit existing schedule (requires user confirmation)",
    parameters: z.object({
      scheduleId: z.string().uuid(),
      name: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      isActive: z.boolean().optional(),
    }),
    requiresConfirmation: true,
  },

  delete_schedule: {
    name: "delete_schedule",
    description: "Delete schedule (requires user confirmation)",
    parameters: z.object({
      scheduleId: z.string().uuid(),
    }),
    requiresConfirmation: true,
  },
} as const;
