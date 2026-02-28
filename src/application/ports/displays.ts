import { type DisplayRegistrationState } from "#/application/ports/display-auth";

export interface DisplayRecord {
  id: string;
  displaySlug: string;
  name: string;
  identifier: string;
  displayFingerprint?: string | null;
  registrationState?: DisplayRegistrationState;
  location: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  outputType?: string | null;
  displayOutput?: string | null;
  orientation?: "LANDSCAPE" | "PORTRAIT" | null;
  lastSeenAt?: string | null;
  refreshNonce?: number;
  registeredAt?: string | null;
  activatedAt?: string | null;
  unregisteredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayRepository {
  list(): Promise<DisplayRecord[]>;
  findByIds(ids: string[]): Promise<DisplayRecord[]>;
  findById(id: string): Promise<DisplayRecord | null>;
  findByIdentifier(identifier: string): Promise<DisplayRecord | null>;
  findBySlug?(displaySlug: string): Promise<DisplayRecord | null>;
  findByFingerprint(fingerprint: string): Promise<DisplayRecord | null>;
  findByFingerprintAndOutput?(
    fingerprint: string,
    displayOutput: string,
  ): Promise<DisplayRecord | null>;
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
  createRegisteredDisplay?(input: {
    displaySlug: string;
    name: string;
    displayFingerprint: string;
    displayOutput: string;
    screenWidth: number;
    screenHeight: number;
    orientation?: "LANDSCAPE" | "PORTRAIT" | null;
    ipAddress?: string | null;
    macAddress?: string | null;
    location?: string | null;
    now: Date;
  }): Promise<DisplayRecord>;
  setRegistrationState?(input: {
    id: string;
    state: DisplayRegistrationState;
    at: Date;
  }): Promise<void>;
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
