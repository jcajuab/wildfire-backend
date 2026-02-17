import { z } from "zod";

export const authLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const patchAuthMeSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  timezone: z.string().max(64).nullable().optional(),
});

export const postAuthMePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export const postAuthForgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const postAuthResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2MB
const AVATAR_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const avatarUploadSchema = z.object({
  file: z
    .instanceof(File)
    .refine((f) => f.size > 0, "File is required")
    .refine(
      (f) =>
        AVATAR_IMAGE_MIMES.includes(
          f.type as (typeof AVATAR_IMAGE_MIMES)[number],
        ),
      "Only image files are allowed (JPEG, PNG, WebP, GIF)",
    )
    .refine(
      (f) => f.size <= AVATAR_MAX_BYTES,
      `File must be ${AVATAR_MAX_BYTES / 1024 / 1024}MB or smaller`,
    ),
});
