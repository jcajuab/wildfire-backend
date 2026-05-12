export type DisplayStatus = "PROCESSING" | "READY" | "LIVE" | "DOWN";

export interface DisplayRecord {
  id: string;
  slug: string;
  name: string;
  fingerprint?: string | null;
  status: DisplayStatus;
  output: string;
  lastSeenAt?: string | null;
  refreshNonce?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayRepository {
  list(): Promise<DisplayRecord[]>;
  listOptions?(input: { q?: string; limit?: number }): Promise<DisplayRecord[]>;
  listOutputOptions?(): Promise<string[]>;
  listForReconciliation(): Promise<DisplayRecord[]>;
  // Pagination convention: { offset, limit } → { items, total } (unified with playlists, content).
  listPage(input: { offset: number; limit: number }): Promise<{
    items: DisplayRecord[];
    total: number;
  }>;
  searchPage(input: {
    offset: number;
    limit: number;
    q?: string;
    status?: DisplayStatus;
    output?: string;
    groupIds?: readonly string[];
    excludeGroupIds?: readonly string[];
    membership?: "ungrouped" | "any";
    sortBy?: "name" | "status" | "groupCount";
    sortDirection?: "asc" | "desc";
  }): Promise<{
    items: DisplayRecord[];
    total: number;
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
  }): Promise<DisplayRecord>;
  update(
    id: string,
    input: {
      name?: string;
      slug?: string;
      fingerprint?: string | null;
      output?: string;
    },
  ): Promise<DisplayRecord | null>;
  createRegisteredDisplay(input: {
    slug: string;
    name: string;
    fingerprint: string;
    output: string;
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
  displayIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DisplayGroupRepository {
  list(): Promise<DisplayGroupRecord[]>;
  listPage(input: {
    offset: number;
    limit: number;
    q?: string;
    displayId?: string;
    membership?: "member" | "non-member";
    sortBy?: "name" | "count";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: DisplayGroupRecord[]; total: number }>;
  findById(id: string): Promise<DisplayGroupRecord | null>;
  findByName(name: string): Promise<DisplayGroupRecord | null>;
  create(input: { name: string }): Promise<DisplayGroupRecord>;
  update(
    id: string,
    input: { name?: string },
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
