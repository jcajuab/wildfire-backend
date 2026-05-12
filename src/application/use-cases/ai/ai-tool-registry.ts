import { z } from "zod";
import { FLASH_MESSAGE_MAX_LENGTH } from "#/domain/content/content";
import { TEXT_CONTENT_MAX_CHARS } from "#/domain/content/text-content";
import { MAX_PLAYLIST_BASE_DURATION_SECONDS } from "#/domain/playlists/playlist";

export interface AIToolDefinition {
  description: string;
  inputSchema: z.ZodTypeAny;
  requiresConfirmation: boolean;
}

const requiredNameSchema = (label: string) =>
  z.string().trim().min(1).max(255).describe(label);

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .describe("Time in 24-hour HH:MM format");

const playlistItemInputSchema = z.object({
  contentId: z
    .string()
    .uuid()
    .describe("Content ID of the item to include in the playlist"),
  duration: z
    .number()
    .int()
    .positive()
    .max(MAX_PLAYLIST_BASE_DURATION_SECONDS)
    .describe(
      `Duration of this content item in seconds. The full playlist cannot exceed ${MAX_PLAYLIST_BASE_DURATION_SECONDS} seconds, and video items cannot exceed their source video duration.`,
    ),
});

const displayIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .describe("Target display IDs. One schedule will be created per display.");

export const AI_TOOLS = {
  create_text_content: {
    description: "Create text content from a plain text message",
    inputSchema: z.object({
      title: requiredNameSchema("Text content title"),
      text: z
        .string()
        .trim()
        .min(1)
        .max(TEXT_CONTENT_MAX_CHARS)
        .describe(
          `Plain text message to display. Maximum ${TEXT_CONTENT_MAX_CHARS} characters. The system handles formatting automatically.`,
        ),
    }),
    requiresConfirmation: false,
  },

  create_playlist: {
    description: "Create a new playlist for organizing content",
    inputSchema: z.object({
      name: requiredNameSchema("Playlist name"),
      description: z
        .string()
        .trim()
        .optional()
        .nullable()
        .describe("Playlist description"),
      showCounter: z
        .boolean()
        .optional()
        .describe("Whether to show the runtime counter overlay"),
      items: z
        .array(playlistItemInputSchema)
        .min(1)
        .describe(
          `Playlist items in playback order. Each item needs contentId and duration. Total base duration cannot exceed ${MAX_PLAYLIST_BASE_DURATION_SECONDS} seconds.`,
        ),
    }),
    requiresConfirmation: false,
  },

  create_schedule: {
    description: "Create playlist schedules for one or more displays",
    inputSchema: z.object({
      playlistId: z.string().uuid().describe("Playlist ID to schedule"),
      name: requiredNameSchema("Schedule name"),
      displayIds: displayIdsSchema,
      startDate: z.string().date().describe("Start date (YYYY-MM-DD)"),
      endDate: z.string().date().describe("End date (YYYY-MM-DD)"),
      startTime: timeSchema,
      endTime: timeSchema,
    }),
    requiresConfirmation: false,
  },

  create_flash_schedule: {
    description: "Create flash content schedules for one or more displays",
    inputSchema: z.object({
      contentId: z.string().uuid().describe("Flash content ID to schedule"),
      name: requiredNameSchema("Schedule name"),
      displayIds: displayIdsSchema,
      startDate: z.string().date().describe("Start date (YYYY-MM-DD)"),
      endDate: z.string().date().describe("End date (YYYY-MM-DD)"),
      startTime: timeSchema,
      endTime: timeSchema,
    }),
    requiresConfirmation: false,
  },

  create_flash_content: {
    description:
      "Create a flash alert message for digital signage displays. Flash messages are short, attention-grabbing alerts.",
    inputSchema: z.object({
      title: requiredNameSchema("Flash content title"),
      message: z
        .string()
        .trim()
        .min(1)
        .max(FLASH_MESSAGE_MAX_LENGTH)
        .describe(
          `Flash message (max ${FLASH_MESSAGE_MAX_LENGTH} characters). Keep it short and impactful.`,
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
    description:
      "Edit existing non-flash content. Use edit_flash_content for flash message or tone changes.",
    inputSchema: z
      .object({
        contentId: z.string().uuid().describe("Content ID to edit"),
        title: requiredNameSchema("New content title").optional(),
        text: z
          .string()
          .trim()
          .min(1)
          .max(TEXT_CONTENT_MAX_CHARS)
          .optional()
          .describe(
            `New plain text message. Maximum ${TEXT_CONTENT_MAX_CHARS} characters. The system handles formatting automatically.`,
          ),
      })
      .refine(
        (value) => value.title !== undefined || value.text !== undefined,
        {
          message: "At least one field must be provided",
        },
      ),
    requiresConfirmation: true,
  },

  edit_flash_content: {
    description: "Edit existing flash content title, message, or tone",
    inputSchema: z
      .object({
        contentId: z.string().uuid().describe("Flash content ID to edit"),
        title: requiredNameSchema("New flash content title").optional(),
        message: z
          .string()
          .trim()
          .min(1)
          .max(FLASH_MESSAGE_MAX_LENGTH)
          .optional()
          .describe(
            `New flash message. Maximum ${FLASH_MESSAGE_MAX_LENGTH} characters.`,
          ),
        tone: z
          .enum(["INFO", "WARNING", "CRITICAL"])
          .optional()
          .describe("New flash tone"),
      })
      .refine(
        (value) =>
          value.title !== undefined ||
          value.message !== undefined ||
          value.tone !== undefined,
        { message: "At least one field must be provided" },
      ),
    requiresConfirmation: true,
  },

  delete_content: {
    description: "Delete content",
    inputSchema: z.object({
      contentId: z.string().uuid().describe("Content ID to delete"),
    }),
    requiresConfirmation: true,
  },

  edit_playlist: {
    description: "Edit existing playlist",
    inputSchema: z.object({
      playlistId: z.string().uuid().describe("Playlist ID to edit"),
      name: requiredNameSchema("New playlist name").optional(),
      description: z
        .string()
        .trim()
        .optional()
        .nullable()
        .describe("New playlist description"),
      showCounter: z
        .boolean()
        .optional()
        .describe("Whether to show the runtime counter overlay"),
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
    description: "Delete playlist",
    inputSchema: z.object({
      playlistId: z.string().uuid().describe("Playlist ID to delete"),
    }),
    requiresConfirmation: true,
  },

  edit_schedule: {
    description: "Edit an existing playlist schedule",
    inputSchema: z.object({
      scheduleId: z.string().uuid().describe("Schedule ID to edit"),
      name: requiredNameSchema("New schedule name").optional(),
      playlistId: z.string().uuid().optional().describe("New playlist ID"),
      displayId: z.string().uuid().optional().describe("New target display ID"),
      startDate: z
        .string()
        .date()
        .optional()
        .describe("New start date (YYYY-MM-DD)"),
      endDate: z
        .string()
        .date()
        .optional()
        .describe("New end date (YYYY-MM-DD)"),
      startTime: timeSchema.optional().describe("New start time (HH:MM)"),
      endTime: timeSchema.optional().describe("New end time (HH:MM)"),
    }),
    requiresConfirmation: true,
  },

  edit_flash_schedule: {
    description: "Edit an existing flash content schedule",
    inputSchema: z.object({
      scheduleId: z.string().uuid().describe("Schedule ID to edit"),
      name: requiredNameSchema("New schedule name").optional(),
      contentId: z.string().uuid().optional().describe("New flash content ID"),
      displayId: z.string().uuid().optional().describe("New target display ID"),
      startDate: z
        .string()
        .date()
        .optional()
        .describe("New start date (YYYY-MM-DD)"),
      endDate: z
        .string()
        .date()
        .optional()
        .describe("New end date (YYYY-MM-DD)"),
      startTime: timeSchema.optional().describe("New start time (HH:MM)"),
      endTime: timeSchema.optional().describe("New end time (HH:MM)"),
    }),
    requiresConfirmation: true,
  },

  delete_schedule: {
    description: "Delete a playlist schedule",
    inputSchema: z.object({
      scheduleId: z.string().uuid().describe("Schedule ID to delete"),
    }),
    requiresConfirmation: true,
  },

  delete_flash_schedule: {
    description: "Delete a flash content schedule",
    inputSchema: z.object({
      scheduleId: z.string().uuid().describe("Schedule ID to delete"),
    }),
    requiresConfirmation: true,
  },

  list_displays: {
    description:
      "List all available displays with compact details (id, name, slug, status, output). Use this to find display IDs before scheduling content.",
    inputSchema: z.object({
      search: z
        .string()
        .trim()
        .optional()
        .describe("Optional search term to filter displays by name"),
    }),
    requiresConfirmation: false,
  },

  list_content: {
    description:
      "List non-flash content owned by the current user with compact details. Returns TEXT, IMAGE, and VIDEO content only. Use this to find existing content before adding to playlists.",
    inputSchema: z.object({
      search: z
        .string()
        .trim()
        .optional()
        .describe("Optional search term to filter content by title"),
    }),
    requiresConfirmation: false,
  },

  list_flash_content: {
    description:
      "List flash content owned by the current user with compact details. Use this to find flash alert IDs before creating or editing flash schedules.",
    inputSchema: z.object({
      search: z
        .string()
        .trim()
        .optional()
        .describe("Optional search term to filter flash content by title"),
    }),
    requiresConfirmation: false,
  },

  list_playlists: {
    description:
      "List playlists owned by the current user with compact details. Use this to find existing playlists before scheduling or adding content.",
    inputSchema: z.object({
      search: z
        .string()
        .trim()
        .optional()
        .describe("Optional search term to filter playlists by name"),
    }),
    requiresConfirmation: false,
  },

  list_schedules: {
    description:
      "List schedules owned by the current user with compact details. Use this to find existing schedules before editing or deleting.",
    inputSchema: z.object({
      search: z
        .string()
        .trim()
        .optional()
        .describe("Optional search term to filter schedules by name"),
    }),
    requiresConfirmation: false,
  },
} as const satisfies Record<string, AIToolDefinition>;
