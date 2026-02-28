export type DisplayRegistrationState =
  | "unpaired"
  | "pairing_in_progress"
  | "registered"
  | "active"
  | "unregistered";

export interface DisplayKeyRecord {
  id: string;
  displayId: string;
  algorithm: "ed25519";
  publicKey: string;
  status: "active" | "revoked";
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayPairingSessionRecord {
  id: string;
  pairingCodeId: string;
  state: "open" | "completed" | "aborted" | "expired";
  challengeNonce: string;
  challengeExpiresAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayStateTransitionRecord {
  id: string;
  displayId: string;
  fromState: DisplayRegistrationState;
  toState: DisplayRegistrationState;
  reason: string;
  actorType: "staff" | "display" | "system";
  actorId: string | null;
  createdAt: string;
}

export interface DisplayKeyRepository {
  create(input: {
    displayId: string;
    algorithm: "ed25519";
    publicKey: string;
  }): Promise<DisplayKeyRecord>;
  findActiveByKeyId(keyId: string): Promise<DisplayKeyRecord | null>;
  findActiveByDisplayId(displayId: string): Promise<DisplayKeyRecord | null>;
  revokeByDisplayId(displayId: string, at: Date): Promise<void>;
}

export interface DisplayPairingSessionRepository {
  create(input: {
    pairingCodeId: string;
    challengeNonce: string;
    challengeExpiresAt: Date;
  }): Promise<DisplayPairingSessionRecord>;
  findOpenById(input: {
    id: string;
    now: Date;
  }): Promise<DisplayPairingSessionRecord | null>;
  complete(id: string, completedAt: Date): Promise<void>;
}

export interface DisplayAuthNonceRepository {
  consumeUnique(input: {
    displayId: string;
    nonce: string;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean>;
}

export interface DisplayStateTransitionRepository {
  create(input: {
    displayId: string;
    fromState: DisplayRegistrationState;
    toState: DisplayRegistrationState;
    reason: string;
    actorType: "staff" | "display" | "system";
    actorId?: string | null;
    createdAt: Date;
  }): Promise<DisplayStateTransitionRecord>;
}
