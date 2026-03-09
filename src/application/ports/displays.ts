export type DisplayStatus = "PROCESSING" | "READY" | "LIVE" | "DOWN";

export interface DisplayRecord {
  id: string;
  slug: string;
  name: string;
  fingerprint?: string | null;
  status: DisplayStatus;
  location: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  output?: string | null;
  orientation?: "LANDSCAPE" | "PORTRAIT" | null;
  emergencyContentId?: string | null;
  lastSeenAt?: string | null;
  refreshNonce?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayRepository {
  list(): Promise<DisplayRecord[]>;
  listPage(input: { page: number; pageSize: number }): Promise<{
    items: DisplayRecord[];
    total: number;
    page: number;
    pageSize: number;
  }>;
  searchPage?(input: {
    page: number;
    pageSize: number;
    q?: string;
    status?: DisplayStatus;
    output?: string;
    groupIds?: readonly string[];
    sortBy?: "name" | "status" | "location";
    sortDirection?: "asc" | "desc";
  }): Promise<{
    items: DisplayRecord[];
    total: number;
    page: number;
    pageSize: number;
  }>;
  findByIds(ids: string[]): Promise<DisplayRecord[]>;
  findById(id: string): Promise<DisplayRecord | null>;
  findBySlug(slug: string): Promise<DisplayRecord | null>;
  findByFingerprint(fingerprint: string): Promise<DisplayRecord | null>;
  findByFingerprintAndOutput(
    fingerprint: string,
    output: string,
  ): Promise<DisplayRecord | null>;
  create(input: {
    name: string;
    slug: string;
    fingerprint?: string | null;
    location: string | null;
  }): Promise<DisplayRecord>;
  update(
    id: string,
    input: {
      name?: string;
      slug?: string;
      fingerprint?: string | null;
      location?: string | null;
      ipAddress?: string | null;
      macAddress?: string | null;
      screenWidth?: number | null;
      screenHeight?: number | null;
      output?: string | null;
      orientation?: "LANDSCAPE" | "PORTRAIT" | null;
      emergencyContentId?: string | null;
    },
  ): Promise<DisplayRecord | null>;
  createRegisteredDisplay(input: {
    slug: string;
    name: string;
    fingerprint: string;
    output: string;
    screenWidth: number;
    screenHeight: number;
    orientation?: "LANDSCAPE" | "PORTRAIT" | null;
    ipAddress?: string | null;
    macAddress?: string | null;
    location?: string | null;
    now: Date;
  }): Promise<DisplayRecord>;
  setStatus(input: {
    id: string;
    status: DisplayStatus;
    at: Date;
  }): Promise<void>;
  delete(id: string): Promise<boolean>;
  touchSeen(id: string, at: Date): Promise<void>;
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

export interface DisplayPreviewRecord {
  readonly displayId: string;
  readonly imageDataUrl: string;
  readonly capturedAt: string;
}

export interface DisplayPreviewRepository {
  upsertLatest(input: DisplayPreviewRecord): Promise<void>;
  findLatestByDisplayId(
    displayId: string,
  ): Promise<DisplayPreviewRecord | null>;
}
