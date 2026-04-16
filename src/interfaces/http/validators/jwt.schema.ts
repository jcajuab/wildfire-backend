import { z } from "zod";

export const jwtPayloadSchema = z.object({
  sub: z.string().min(1),
  username: z.string().min(1),
  email: z.string().email().optional(),
  name: z.string().min(1),
  timezone: z.string().nullable().optional(),
  iat: z.number().int().optional(),
  exp: z.number().int().optional(),
  iss: z.string().optional(),
  isAdmin: z.boolean(),
  isInvitedUser: z.boolean().optional(),
  permissions: z.array(z.string()).default([]),
  sid: z.string().optional(),
  jti: z.string().optional(),
});

export type JwtPayload = z.infer<typeof jwtPayloadSchema>;
