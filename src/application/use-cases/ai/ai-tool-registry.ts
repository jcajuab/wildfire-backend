import { z } from "zod";

const playlistItemInputSchema = z.object({
  contentId: z
    .string()
    .uuid()
    .describe("Content ID of the item to include in the playlist"),
  duration: z
    .number()
    .int()
    .positive()
    .describe("Duration of this content item in seconds"),
});

export const AI_TOOLS = {
  create_text_content: {
    description: "Create text-based content from plain text",
    inputSchema: z.object({
      title: z.string().min(1).describe("Content title"),
      text: z
        .string()
        .min(1)
        .describe(
          "Plain text content to display. The system handles formatting automatically.",
        ),
    }),
    requiresConfirmation: false,
  },

  create_playlist: {
    description: "Create a new playlist for organizing content",
    inputSchema: z.object({
      name: z.string().min(1).describe("Playlist name"),
      description: z.string().optional().describe("Playlist description"),
      items: z
        .array(playlistItemInputSchema)
        .min(1)
        .optional()
        .describe(
          "Optional initial playlist items in playback order. Each item needs contentId and duration.",
        ),
    }),
    requiresConfirmation: false,
  },

  create_schedule: {
    description: "Create a schedule to display content on a specific display",
    inputSchema: z.object({
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

  create_flash_content: {
    description:
      "Create a flash alert message for digital signage displays. Flash messages are short, attention-grabbing alerts.",
    inputSchema: z.object({
      title: z.string().min(1).describe("Content title"),
      text: z
        .string()
        .min(1)
        .max(240)
        .describe(
          "Flash message text (max 240 characters). Keep it short and impactful.",
        ),
      tone: z
        .enum(["INFO", "WARNING", "CRITICAL"])
        .default("INFO")
        .describe(
          "Alert tone: INFO for general notices, WARNING for caution, CRITICAL for urgent alerts",
        ),
    }),
    requiresConfirmation: false,
  },

  edit_content: {
    description: "Edit existing content (requires user confirmation)",
    inputSchema: z.object({
      contentId: z.string().uuid(),
      title: z.string().optional(),
      jsonContent: z.string().optional(),
      htmlContent: z.string().optional(),
    }),
    requiresConfirmation: true,
  },

  delete_content: {
    description: "Delete content (requires user confirmation)",
    inputSchema: z.object({
      contentId: z.string().uuid(),
    }),
    requiresConfirmation: true,
  },

  edit_playlist: {
    description: "Edit existing playlist (requires user confirmation)",
    inputSchema: z.object({
      playlistId: z.string().uuid(),
      name: z.string().optional(),
      description: z.string().optional(),
      items: z
        .array(playlistItemInputSchema)
        .min(1)
        .optional()
        .describe(
          "Optional playlist replacement items in playback order. Each item needs contentId and duration.",
        ),
    }),
    requiresConfirmation: true,
  },

  delete_playlist: {
    description: "Delete playlist (requires user confirmation)",
    inputSchema: z.object({
      playlistId: z.string().uuid(),
    }),
    requiresConfirmation: true,
  },

  edit_schedule: {
    description: "Edit existing schedule (requires user confirmation)",
    inputSchema: z.object({
      scheduleId: z.string().uuid(),
      name: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      isActive: z.boolean().optional(),
    }),
    requiresConfirmation: true,
  },

  delete_schedule: {
    description: "Delete schedule (requires user confirmation)",
    inputSchema: z.object({
      scheduleId: z.string().uuid(),
    }),
    requiresConfirmation: true,
  },

  list_displays: {
    description:
      "List all available displays with their details (id, name, status, groups, location). Use this to find display IDs before scheduling content.",
    inputSchema: z.object({
      search: z
        .string()
        .optional()
        .describe("Optional search term to filter displays by name"),
    }),
    requiresConfirmation: false,
  },

  list_content: {
    description:
      "List content owned by the current user with full details. Use this to find existing content before adding to playlists or scheduling.",
    inputSchema: z.object({
      search: z
        .string()
        .optional()
        .describe("Optional search term to filter content by title"),
    }),
    requiresConfirmation: false,
  },

  list_playlists: {
    description:
      "List playlists owned by the current user with full details. Use this to find existing playlists before scheduling or adding content.",
    inputSchema: z.object({
      search: z
        .string()
        .optional()
        .describe("Optional search term to filter playlists by name"),
    }),
    requiresConfirmation: false,
  },
} as const;
