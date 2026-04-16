import { sign } from "hono/jwt";
import { type TokenIssuer } from "#/application/ports/auth";

interface JwtTokenIssuerDeps {
  secret: string;
  issuer?: string;
}

export class JwtTokenIssuer implements TokenIssuer {
  constructor(private readonly deps: JwtTokenIssuerDeps) {}

  issueToken(input: {
    subject: string;
    issuedAt: number;
    expiresAt: number;
    issuer?: string;
    username?: string;
    email?: string;
    name?: string;
    timezone?: string | null;
    isAdmin?: boolean;
    isInvitedUser?: boolean;
    permissions?: string[];
    sessionId?: string;
    jti?: string;
  }): Promise<string> {
    const payload = {
      sub: input.subject,
      username: input.username,
      email: input.email,
      name: input.name ?? input.username ?? input.subject,
      timezone: input.timezone ?? null,
      iat: input.issuedAt,
      exp: input.expiresAt,
      iss: input.issuer ?? this.deps.issuer,
      isAdmin: input.isAdmin ?? false,
      isInvitedUser: input.isInvitedUser ?? false,
      permissions: input.permissions ?? [],
      ...(input.sessionId
        ? {
            sid: input.sessionId,
            jti: input.jti ?? input.sessionId,
          }
        : {}),
    };

    return sign(payload, this.deps.secret, "HS256");
  }
}
