export interface RuntimeControlRecord {
  id: "global";
  globalEmergencyActive: boolean;
  globalEmergencyStartedAt: string | null;
  activeSlotIndex: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeControlRepository {
  getGlobal(): Promise<RuntimeControlRecord>;
  setGlobalEmergencyState(input: {
    active: boolean;
    startedAt: Date | null;
    activeSlotIndex: number | null;
    at: Date;
  }): Promise<RuntimeControlRecord>;
}
