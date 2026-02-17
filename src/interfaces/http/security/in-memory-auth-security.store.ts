interface AttemptState {
  firstAttemptAtMs: number;
  attemptCount: number;
  lockedUntilMs?: number;
}

export class InMemoryAuthSecurityStore {
  private readonly loginAttempts = new Map<string, AttemptState>();
  private readonly endpointAttempts = new Map<string, AttemptState>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Start periodic sweep of expired entries (default: every 5 minutes). */
  startCleanup(intervalMs = 5 * 60 * 1000): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.sweep(Date.now()), intervalMs);
    // Allow the process to exit without waiting for the timer
    if (typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Remove entries whose window has expired. */
  private sweep(nowMs: number): void {
    // Max window we track is 15 minutes; sweep anything older than 30 min
    const staleThresholdMs = 30 * 60 * 1000;
    for (const [key, state] of this.loginAttempts) {
      const age = nowMs - state.firstAttemptAtMs;
      const pastLockout = !state.lockedUntilMs || state.lockedUntilMs <= nowMs;
      if (age > staleThresholdMs && pastLockout) {
        this.loginAttempts.delete(key);
      }
    }
    for (const [key, state] of this.endpointAttempts) {
      if (nowMs - state.firstAttemptAtMs > staleThresholdMs) {
        this.endpointAttempts.delete(key);
      }
    }
  }

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
