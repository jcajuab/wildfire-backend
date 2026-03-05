export type FlashTone = "INFO" | "WARNING" | "CRITICAL";
export type FlashActivationStatus = "ACTIVE" | "STOPPED" | "EXPIRED";

export interface FlashActivationRecord {
  id: string;
  contentId: string;
  targetDisplayId: string;
  message: string;
  tone: FlashTone;
  status: FlashActivationStatus;
  startedAt: string;
  endsAt: string;
  stoppedAt: string | null;
  stoppedReason: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  replacementCount: number;
}

export interface FlashActivationRepository {
  findActive(now: Date): Promise<FlashActivationRecord | null>;
  findById(id: string): Promise<FlashActivationRecord | null>;
  create(input: {
    id: string;
    contentId: string;
    targetDisplayId: string;
    message: string;
    tone: FlashTone;
    startedAt: Date;
    endsAt: Date;
    createdById: string;
  }): Promise<FlashActivationRecord>;
  stopById(input: {
    id: string;
    stoppedAt: Date;
    reason: string;
    status?: "STOPPED" | "EXPIRED";
  }): Promise<FlashActivationRecord | null>;
  stopActive(input: {
    stoppedAt: Date;
    reason: string;
    status?: "STOPPED" | "EXPIRED";
  }): Promise<FlashActivationRecord | null>;
  createReplacingActive(input: {
    replacementOfId: string;
    replacementStoppedAt: Date;
    replacementReason: string;
    id: string;
    contentId: string;
    targetDisplayId: string;
    message: string;
    tone: FlashTone;
    startedAt: Date;
    endsAt: Date;
    createdById: string;
  }): Promise<{
    stopped: FlashActivationRecord | null;
    created: FlashActivationRecord;
  }>;
}
