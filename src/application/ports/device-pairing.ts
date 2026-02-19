export interface DevicePairingCodeRecord {
  id: string;
  codeHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface DevicePairingCodeRepository {
  create(input: {
    codeHash: string;
    expiresAt: Date;
    createdById: string;
  }): Promise<DevicePairingCodeRecord>;
  consumeValidCode(input: {
    codeHash: string;
    now: Date;
  }): Promise<DevicePairingCodeRecord | null>;
}
