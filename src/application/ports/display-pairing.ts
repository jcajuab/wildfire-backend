export interface DisplayPairingCodeRecord {
  id: string;
  codeHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayPairingCodeRepository {
  create(input: {
    codeHash: string;
    expiresAt: Date;
    createdById: string;
  }): Promise<DisplayPairingCodeRecord>;
  consumeValidCode(input: {
    codeHash: string;
    now: Date;
  }): Promise<DisplayPairingCodeRecord | null>;
}
