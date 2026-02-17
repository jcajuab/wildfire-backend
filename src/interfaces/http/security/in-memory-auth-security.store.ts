interface AttemptState {
  firstAttemptAtMs: number;
  attemptCount: number;
  lockedUntilMs?: number;
}

export class InMemoryAuthSecurityStore {
  private readonly loginAttempts = new Map<string, AttemptState>();
  private readonly endpointAttempts = new Map<string, AttemptState>();

  checkLoginAllowed(
    key: string,
    nowMs: number,
  ): {
    allowed: boolean;
    retryAfterSeconds?: number;
  } {
    const state = this.loginAttempts.get(key);
    if (!state?.lockedUntilMs || state.lockedUntilMs <= nowMs) {
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

  registerLoginFailure(input: {
    key: string;
    nowMs: number;
    windowSeconds: number;
    lockoutThreshold: number;
    lockoutSeconds: number;
  }): void {
    const windowMs = input.windowSeconds * 1000;
    const lockoutMs = input.lockoutSeconds * 1000;
    const current = this.loginAttempts.get(input.key);
    const reset =
      !current || input.nowMs - current.firstAttemptAtMs > windowMs
        ? {
            firstAttemptAtMs: input.nowMs,
            attemptCount: 0,
          }
        : current;
    const attemptCount = reset.attemptCount + 1;
    const next: AttemptState = {
      firstAttemptAtMs: reset.firstAttemptAtMs,
      attemptCount,
      lockedUntilMs:
        attemptCount >= input.lockoutThreshold
          ? input.nowMs + lockoutMs
          : reset.lockedUntilMs,
    };
    this.loginAttempts.set(input.key, next);
  }

  clearLoginFailures(key: string): void {
    this.loginAttempts.delete(key);
  }

  consumeEndpointAttempt(input: {
    key: string;
    nowMs: number;
    windowSeconds: number;
    maxAttempts: number;
  }): boolean {
    const windowMs = input.windowSeconds * 1000;
    const current = this.endpointAttempts.get(input.key);
    const reset =
      !current || input.nowMs - current.firstAttemptAtMs > windowMs
        ? {
            firstAttemptAtMs: input.nowMs,
            attemptCount: 0,
          }
        : current;
    const attemptCount = reset.attemptCount + 1;
    this.endpointAttempts.set(input.key, {
      firstAttemptAtMs: reset.firstAttemptAtMs,
      attemptCount,
    });
    return attemptCount <= input.maxAttempts;
  }
}
