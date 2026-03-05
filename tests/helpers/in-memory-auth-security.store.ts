import { type AuthSecurityStore } from "#/interfaces/http/security/redis-auth-security.store";

interface AttemptState {
  firstAttemptAtMs: number;
  attemptCount: number;
  lockedUntilMs: number | null;
}

const getWindowResetMs = (input: {
  firstAttemptAtMs: number;
  windowSeconds: number;
}): number => input.firstAttemptAtMs + input.windowSeconds * 1000;

export class InMemoryAuthSecurityStore implements AuthSecurityStore {
  private readonly loginAttempts = new Map<string, AttemptState>();
  private readonly endpointAttempts = new Map<string, AttemptState>();

  async checkLoginAllowed(
    key: string,
    nowMs: number,
  ): Promise<{
    allowed: boolean;
    retryAfterSeconds?: number;
  }> {
    const state = this.loginAttempts.get(key);
    if (!state || state.lockedUntilMs == null || state.lockedUntilMs <= nowMs) {
      return { allowed: true };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((state.lockedUntilMs - nowMs) / 1000),
      ),
    };
  }

  async registerLoginFailure(input: {
    key: string;
    nowMs: number;
    windowSeconds: number;
    lockoutThreshold: number;
    lockoutSeconds: number;
  }): Promise<void> {
    const existing = this.loginAttempts.get(input.key);
    const windowMs = input.windowSeconds * 1000;

    let firstAttemptAtMs = input.nowMs;
    let attemptCount = 0;
    if (existing && input.nowMs - existing.firstAttemptAtMs <= windowMs) {
      firstAttemptAtMs = existing.firstAttemptAtMs;
      attemptCount = existing.attemptCount;
    }

    attemptCount += 1;
    const lockedUntilMs =
      attemptCount >= input.lockoutThreshold
        ? input.nowMs + input.lockoutSeconds * 1000
        : null;

    this.loginAttempts.set(input.key, {
      firstAttemptAtMs,
      attemptCount,
      lockedUntilMs,
    });
  }

  async clearLoginFailures(key: string): Promise<void> {
    this.loginAttempts.delete(key);
  }

  async consumeEndpointAttempt(input: {
    key: string;
    nowMs: number;
    windowSeconds: number;
    maxAttempts: number;
  }): Promise<boolean> {
    const result = await this.consumeEndpointAttemptWithStats(input);
    return result.allowed;
  }

  async consumeEndpointAttemptWithStats(input: {
    key: string;
    nowMs: number;
    windowSeconds: number;
    maxAttempts: number;
  }): Promise<{
    allowed: boolean;
    limit: number;
    remaining: number;
    retryAfterSeconds: number;
    resetEpochSeconds: number;
  }> {
    const existing = this.endpointAttempts.get(input.key);
    const windowMs = input.windowSeconds * 1000;

    let firstAttemptAtMs = input.nowMs;
    let attemptCount = 0;
    if (existing && input.nowMs - existing.firstAttemptAtMs <= windowMs) {
      firstAttemptAtMs = existing.firstAttemptAtMs;
      attemptCount = existing.attemptCount;
    }

    attemptCount += 1;
    this.endpointAttempts.set(input.key, {
      firstAttemptAtMs,
      attemptCount,
      lockedUntilMs: null,
    });

    const resetMs = getWindowResetMs({
      firstAttemptAtMs,
      windowSeconds: input.windowSeconds,
    });
    const allowed = attemptCount <= input.maxAttempts;

    return {
      allowed,
      limit: input.maxAttempts,
      remaining: Math.max(0, input.maxAttempts - attemptCount),
      retryAfterSeconds: Math.max(1, Math.ceil((resetMs - input.nowMs) / 1000)),
      resetEpochSeconds: Math.ceil(resetMs / 1000),
    };
  }
}
