import { type Clock, type TokenIssuer } from "#/application/ports/auth";
import { type UserRepository } from "#/application/ports/rbac";
import { InvalidCredentialsError } from "#/application/use-cases/auth/errors";

export interface RefreshSessionInput {
  userId: string;
}

export interface RefreshSessionResult {
  type: "bearer";
  token: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    name: string;
    timezone?: string | null;
    avatarKey?: string | null;
  };
}

interface RefreshSessionDeps {
  tokenIssuer: TokenIssuer;
  userRepository: UserRepository;
  clock: Clock;
  tokenTtlSeconds: number;
  issuer?: string;
}

export class RefreshSessionUseCase {
  constructor(private readonly deps: RefreshSessionDeps) {}

  async execute(input: RefreshSessionInput): Promise<RefreshSessionResult> {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) {
      throw new InvalidCredentialsError();
    }
    if (!user.isActive) {
      throw new InvalidCredentialsError(
        "Your account is currently deactivated. Please contact your administrator.",
      );
    }

    const issuedAt = this.deps.clock.nowSeconds();
    const expiresAt = issuedAt + this.deps.tokenTtlSeconds;
    const token = await this.deps.tokenIssuer.issueToken({
      subject: user.id,
      issuedAt,
      expiresAt,
      issuer: this.deps.issuer,
      email: user.email,
    });

    return {
      type: "bearer",
      token,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        timezone: user.timezone ?? null,
        avatarKey: user.avatarKey ?? null,
      },
    };
  }
}
