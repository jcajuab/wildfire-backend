import { z } from "zod";

export const displayRuntimeSettingsSchema = z.object({
  scrollPxPerSecond: z.number().int().min(1).max(200),
});

export const updateDisplayRuntimeSettingsSchema = z.object({
  scrollPxPerSecond: z.number().int().min(1).max(200),
});
