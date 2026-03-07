import { z } from "zod";
import {
  apiResponseSchema,
  errorResponseSchema,
} from "#/interfaces/http/responses";

export const displayRuntimeTags = ["Display Runtime"];

export const createChallengeBodySchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  keyId: z.string().uuid(),
});

export const verifyChallengeBodySchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  keyId: z.string().uuid(),
  signature: z.string().min(1),
});

export const slugParamSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export const challengeTokenParamSchema = z.object({
  challengeToken: z.string().min(1),
});

export const snapshotBodySchema = z.object({
  imageDataUrl: z.string().min(1),
  capturedAt: z.string().datetime().optional(),
});

export const challengeResponseSchema = apiResponseSchema(
  z.object({
    challengeToken: z.string().min(1),
    expiresAt: z.string(),
  }),
);

export { errorResponseSchema };
