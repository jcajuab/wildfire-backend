import { type OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

export const emergencySlotIndexParamSchema = z.object({
  slotIndex: z.coerce.number().int().min(1).max(5),
});

export const setEmergencySlotSchema = z.object({
  label: z.string().trim().min(1).max(64),
  contentId: z.string().uuid(),
});

export const setEmergencySlotRequestBodySchema: OpenAPIV3_1.SchemaObject = {
  type: "object",
  properties: {
    label: { type: "string", minLength: 1, maxLength: 64 },
    contentId: { type: "string", format: "uuid" },
  },
  required: ["label", "contentId"],
  additionalProperties: false,
};

export const emergencySlotContentSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    type: z.enum(["IMAGE", "VIDEO", "FLASH", "TEXT"]),
    status: z.enum(["PROCESSING", "READY", "FAILED"]),
    thumbnailKey: z.string().nullable(),
  })
  .nullable();

export const emergencySlotSchema = z.object({
  slotIndex: z.number().int().min(1).max(5),
  label: z.string().nullable(),
  contentId: z.string().uuid().nullable(),
  content: emergencySlotContentSchema,
  updatedAt: z.string().nullable(),
});

export const emergencySlotsResponseSchema = z.array(emergencySlotSchema);
