import { z } from "zod";

export const jwtPayloadSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email().optional(),
  iat: z.number().int().optional(),
  exp: z.number().int().optional(),
  iss: z.string().optional(),
  sid: z.string().optional(),
  jti: z.string().optional(),
});

export type JwtPayload = z.infer<typeof jwtPayloadSchema>;
