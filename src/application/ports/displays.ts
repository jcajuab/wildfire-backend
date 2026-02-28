export interface DisplayRecord {
  id: string;
  name: string;
  identifier: string;
  displayFingerprint?: string | null;
  location: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  outputType?: string | null;
  orientation?: "LANDSCAPE" | "PORTRAIT" | null;
  lastSeenAt?: string | null;
  refreshNonce?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayRepository {
  list(): Promise<DisplayRecord[]>;
  findByIds(ids: string[]): Promise<DisplayRecord[]>;
  findById(id: string): Promise<DisplayRecord | null>;
  findByIdentifier(identifier: string): Promise<DisplayRecord | null>;
  findByFingerprint(fingerprint: string): Promise<DisplayRecord | null>;
  create(input: {
    name: string;
    identifier: string;
    displayFingerprint?: string | null;
    location: string | null;
  }): Promise<DisplayRecord>;
  update(
    id: string,
    input: {
      name?: string;
      identifier?: string;
      displayFingerprint?: string | null;
      location?: string | null;
      ipAddress?: string | null;
      macAddress?: string | null;
      screenWidth?: number | null;
      screenHeight?: number | null;
      outputType?: string | null;
      orientation?: "LANDSCAPE" | "PORTRAIT" | null;
    },
  ): Promise<DisplayRecord | null>;
  touchSeen?(id: string, at: Date): Promise<void>;
  bumpRefreshNonce(id: string): Promise<boolean>;
}

export interface DisplayGroupRecord {
  id: string;
  name: string;
  colorIndex: number;
  displayIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DisplayGroupRepository {
  list(): Promise<DisplayGroupRecord[]>;
  findById(id: string): Promise<DisplayGroupRecord | null>;
  findByName(name: string): Promise<DisplayGroupRecord | null>;
  create(input: {
    name: string;
    colorIndex: number;
  }): Promise<DisplayGroupRecord>;
  update(
    id: string,
    input: { name?: string; colorIndex?: number },
  ): Promise<DisplayGroupRecord | null>;
  delete(id: string): Promise<boolean>;
  setDisplayGroups(displayId: string, groupIds: string[]): Promise<void>;
}
