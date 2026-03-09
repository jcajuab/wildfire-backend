export interface DisplayPairingCodeRecord {
  id: string;
  codeHash: string;
  expiresAt: string;
  usedAt: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export class DisplayPairingCodeCollisionError extends Error {
  constructor() {
    super("Display pairing code collision detected");
    this.name = "DisplayPairingCodeCollisionError";
  }
}

export interface DisplayPairingCodeRepository {
  create(input: {
    codeHash: string;
    expiresAt: Date;
    ownerId: string;
  }): Promise<DisplayPairingCodeRecord>;
  consumeValidCode(input: {
    codeHash: string;
    now: Date;
  }): Promise<DisplayPairingCodeRecord | null>;
  invalidateById(input: { id: string; now: Date }): Promise<void>;
}
