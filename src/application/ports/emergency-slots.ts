export interface EmergencySlotRecord {
  slotIndex: number;
  label: string;
  contentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmergencySlotRepository {
  list(): Promise<EmergencySlotRecord[]>;
  findByIndex(slotIndex: number): Promise<EmergencySlotRecord | null>;
  upsert(input: {
    slotIndex: number;
    label: string;
    contentId: string | null;
    at: Date;
  }): Promise<EmergencySlotRecord>;
  delete(slotIndex: number): Promise<boolean>;
}
