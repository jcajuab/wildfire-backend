export interface RegistrationAttemptCode {
  code: string;
  codeHash: string;
  pairingCodeId: string;
  expiresAt: Date;
}

export interface RegistrationSucceededEvent {
  type: "registration_succeeded";
  attemptId: string;
  displayId: string;
  slug: string;
  occurredAt: string;
}

export interface DisplayRegistrationAttemptEventPublisher {
  publish(event: RegistrationSucceededEvent): void;
}

export interface DisplayRegistrationAttemptEventSubscription {
  subscribe(
    attemptId: string,
    handler: (event: RegistrationSucceededEvent) => void,
  ): () => void;
}

export interface DisplayRegistrationAttemptStore {
  createOrReplaceOpenAttempt(input: {
    createdById: string;
    activeCode: RegistrationAttemptCode;
  }): Promise<{ attemptId: string; invalidatedPairingCodeId: string | null }>;
  rotateCode(input: {
    attemptId: string;
    createdById: string;
    nextCode: RegistrationAttemptCode;
  }): Promise<{ invalidatedPairingCodeId: string | null } | null>;
  closeAttempt(input: {
    attemptId: string;
    createdById: string;
  }): Promise<{ invalidatedPairingCodeId: string | null } | null>;
  isAttemptOwnedBy(input: {
    attemptId: string;
    createdById: string;
  }): Promise<boolean>;
  consumeCodeHash(input: {
    codeHash: string;
    now: Date;
  }): Promise<{ attemptId: string; pairingCodeId: string } | null>;
  bindSessionAttempt(input: {
    sessionId: string;
    attemptId: string;
  }): Promise<void>;
  consumeSessionAttemptId(sessionId: string): Promise<string | null>;
}
