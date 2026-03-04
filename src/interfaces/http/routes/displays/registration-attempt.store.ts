import { randomUUID } from "node:crypto";

export interface RegistrationAttemptCode {
  code: string;
  codeHash: string;
  pairingCodeId: string;
  expiresAt: Date;
}

interface RegistrationAttemptRecord {
  id: string;
  createdById: string;
  createdAt: Date;
  closedAt: Date | null;
  activeCode: RegistrationAttemptCode | null;
}

export class InMemoryDisplayRegistrationAttemptStore {
  private readonly attemptsById = new Map<string, RegistrationAttemptRecord>();
  private readonly openAttemptIdByUserId = new Map<string, string>();
  private readonly attemptIdByCodeHash = new Map<string, string>();
  private readonly attemptIdBySessionId = new Map<string, string>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  startCleanup(intervalMs = 60_000): void {
    if (this.cleanupTimer) {
      return;
    }
    this.cleanupTimer = setInterval(() => this.sweep(new Date()), intervalMs);
    if (typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  stopCleanup(): void {
    if (!this.cleanupTimer) {
      return;
    }
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  private sweep(now: Date): void {
    const staleMs = 30 * 60 * 1000;
    const attemptIdsToDelete: string[] = [];
    const nowMs = now.getTime();

    for (const [attemptId, attempt] of this.attemptsById) {
      const isClosedAndStale =
        attempt.closedAt !== null &&
        nowMs - attempt.closedAt.getTime() > staleMs;
      const hasExpiredCode =
        attempt.activeCode !== null &&
        attempt.activeCode.expiresAt.getTime() <= nowMs;
      const isInactiveAndStale =
        attempt.activeCode === null &&
        nowMs - attempt.createdAt.getTime() > staleMs;

      if (hasExpiredCode && attempt.activeCode) {
        this.attemptIdByCodeHash.delete(attempt.activeCode.codeHash);
        attempt.activeCode = null;
      }

      if (isClosedAndStale || isInactiveAndStale) {
        attemptIdsToDelete.push(attemptId);
      }
    }

    if (attemptIdsToDelete.length === 0) {
      return;
    }

    const removeSet = new Set(attemptIdsToDelete);
    for (const [sessionId, attemptId] of this.attemptIdBySessionId) {
      if (removeSet.has(attemptId)) {
        this.attemptIdBySessionId.delete(sessionId);
      }
    }

    for (const attemptId of attemptIdsToDelete) {
      const attempt = this.attemptsById.get(attemptId);
      if (!attempt) {
        continue;
      }
      if (this.openAttemptIdByUserId.get(attempt.createdById) === attemptId) {
        this.openAttemptIdByUserId.delete(attempt.createdById);
      }
      this.attemptsById.delete(attemptId);
    }
  }

  createOrReplaceOpenAttempt(input: {
    createdById: string;
    activeCode: RegistrationAttemptCode;
  }): { attemptId: string; invalidatedPairingCodeId: string | null } {
    const existingAttemptId = this.openAttemptIdByUserId.get(input.createdById);
    let invalidatedPairingCodeId: string | null = null;
    if (existingAttemptId) {
      const existing = this.attemptsById.get(existingAttemptId);
      if (existing) {
        existing.closedAt = new Date();
        if (existing.activeCode) {
          this.attemptIdByCodeHash.delete(existing.activeCode.codeHash);
          invalidatedPairingCodeId = existing.activeCode.pairingCodeId;
        }
        existing.activeCode = null;
      }
    }

    const attemptId = randomUUID();
    this.attemptsById.set(attemptId, {
      id: attemptId,
      createdById: input.createdById,
      createdAt: new Date(),
      closedAt: null,
      activeCode: input.activeCode,
    });
    this.openAttemptIdByUserId.set(input.createdById, attemptId);
    this.attemptIdByCodeHash.set(input.activeCode.codeHash, attemptId);

    return { attemptId, invalidatedPairingCodeId };
  }

  rotateCode(input: {
    attemptId: string;
    createdById: string;
    nextCode: RegistrationAttemptCode;
  }): {
    invalidatedPairingCodeId: string | null;
  } | null {
    const attempt = this.attemptsById.get(input.attemptId);
    if (!attempt || attempt.createdById !== input.createdById) {
      return null;
    }
    if (attempt.closedAt !== null) {
      return null;
    }

    let invalidatedPairingCodeId: string | null = null;
    if (attempt.activeCode) {
      this.attemptIdByCodeHash.delete(attempt.activeCode.codeHash);
      invalidatedPairingCodeId = attempt.activeCode.pairingCodeId;
    }

    attempt.activeCode = input.nextCode;
    this.attemptIdByCodeHash.set(input.nextCode.codeHash, attempt.id);

    return { invalidatedPairingCodeId };
  }

  closeAttempt(input: {
    attemptId: string;
    createdById: string;
  }): { invalidatedPairingCodeId: string | null } | null {
    const attempt = this.attemptsById.get(input.attemptId);
    if (!attempt || attempt.createdById !== input.createdById) {
      return null;
    }
    if (attempt.closedAt !== null) {
      return { invalidatedPairingCodeId: null };
    }

    attempt.closedAt = new Date();
    this.openAttemptIdByUserId.delete(input.createdById);

    let invalidatedPairingCodeId: string | null = null;
    if (attempt.activeCode) {
      this.attemptIdByCodeHash.delete(attempt.activeCode.codeHash);
      invalidatedPairingCodeId = attempt.activeCode.pairingCodeId;
      attempt.activeCode = null;
    }
    return { invalidatedPairingCodeId };
  }

  isAttemptOwnedBy(input: { attemptId: string; createdById: string }): boolean {
    const attempt = this.attemptsById.get(input.attemptId);
    return attempt?.createdById === input.createdById;
  }

  consumeCodeHash(input: {
    codeHash: string;
    now: Date;
  }): { attemptId: string; pairingCodeId: string } | null {
    const attemptId = this.attemptIdByCodeHash.get(input.codeHash);
    if (!attemptId) return null;
    const attempt = this.attemptsById.get(attemptId);
    if (!attempt || attempt.closedAt !== null || !attempt.activeCode) {
      this.attemptIdByCodeHash.delete(input.codeHash);
      return null;
    }
    if (attempt.activeCode.codeHash !== input.codeHash) {
      return null;
    }
    if (attempt.activeCode.expiresAt.getTime() <= input.now.getTime()) {
      this.attemptIdByCodeHash.delete(input.codeHash);
      attempt.activeCode = null;
      return null;
    }

    this.attemptIdByCodeHash.delete(input.codeHash);
    const pairingCodeId = attempt.activeCode.pairingCodeId;
    attempt.activeCode = null;
    return { attemptId, pairingCodeId };
  }

  bindSessionAttempt(input: { sessionId: string; attemptId: string }): void {
    this.attemptIdBySessionId.set(input.sessionId, input.attemptId);
  }

  consumeSessionAttemptId(sessionId: string): string | null {
    const attemptId = this.attemptIdBySessionId.get(sessionId);
    if (!attemptId) return null;
    this.attemptIdBySessionId.delete(sessionId);
    return attemptId;
  }
}
