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
    sessionId?: string;
    jti?: string;
    isInvitedUser?: boolean;
  }): Promise<string> {
    const payload = {
      sub: input.subject,
      username: input.username,
      email: input.email,
      iat: input.issuedAt,
      exp: input.expiresAt,
      iss: input.issuer ?? this.deps.issuer,
      isInvitedUser: input.isInvitedUser ?? false,
      ...(input.sessionId
        ? {
            sid: input.sessionId,
            jti: input.jti ?? input.sessionId,
          }
        : {}),
    };

    return sign(payload, this.deps.secret);
  }
}
