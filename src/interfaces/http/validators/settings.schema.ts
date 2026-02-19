import { z } from "zod";

export const deviceRuntimeSettingsSchema = z.object({
  scrollPxPerSecond: z.number().int().min(1).max(200),
});

export const updateDeviceRuntimeSettingsSchema = z.object({
  scrollPxPerSecond: z.number().int().min(1).max(200),
});
