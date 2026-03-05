export interface RuntimeControlRecord {
  id: "global";
  globalEmergencyActive: boolean;
  globalEmergencyStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeControlRepository {
  getGlobal(): Promise<RuntimeControlRecord>;
  setGlobalEmergencyState(input: {
    active: boolean;
    startedAt: Date | null;
    at: Date;
  }): Promise<RuntimeControlRecord>;
}
