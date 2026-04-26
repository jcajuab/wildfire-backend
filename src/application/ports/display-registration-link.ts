export interface RegistrationLinkRecord {
  token: string;
  slug: string;
  displayName: string;
  output: string;
  resolutionWidth: number;
  resolutionHeight: number;
  displayGroups: string[];
  challengeNonce: string;
  attemptId: string;
  ownerId: string;
  expiresAtMs: number;
}

export interface RegistrationLinkMetadata {
  slug: string;
  output: string;
  challengeNonce: string;
  expiresAt: string;
}

export interface DisplayRegistrationLinkStore {
  create(record: RegistrationLinkRecord): Promise<void>;
  peek(token: string, now: Date): Promise<RegistrationLinkRecord | null>;
  consume(token: string, now: Date): Promise<RegistrationLinkRecord | null>;
}
