export interface DeviceRecord {
  id: string;
  name: string;
  identifier: string;
  deviceFingerprint?: string | null;
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

export interface DeviceRepository {
  list(): Promise<DeviceRecord[]>;
  findByIds(ids: string[]): Promise<DeviceRecord[]>;
  findById(id: string): Promise<DeviceRecord | null>;
  findByIdentifier(identifier: string): Promise<DeviceRecord | null>;
  findByFingerprint(fingerprint: string): Promise<DeviceRecord | null>;
  create(input: {
    name: string;
    identifier: string;
    deviceFingerprint?: string | null;
    location: string | null;
  }): Promise<DeviceRecord>;
  update(
    id: string,
    input: {
      name?: string;
      identifier?: string;
      deviceFingerprint?: string | null;
      location?: string | null;
      ipAddress?: string | null;
      macAddress?: string | null;
      screenWidth?: number | null;
      screenHeight?: number | null;
      outputType?: string | null;
      orientation?: "LANDSCAPE" | "PORTRAIT" | null;
    },
  ): Promise<DeviceRecord | null>;
  touchSeen?(id: string, at: Date): Promise<void>;
  bumpRefreshNonce(id: string): Promise<boolean>;
}

export interface DeviceGroupRecord {
  id: string;
  name: string;
  deviceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DeviceGroupRepository {
  list(): Promise<DeviceGroupRecord[]>;
  findById(id: string): Promise<DeviceGroupRecord | null>;
  findByName(name: string): Promise<DeviceGroupRecord | null>;
  create(input: { name: string }): Promise<DeviceGroupRecord>;
  update(
    id: string,
    input: { name?: string },
  ): Promise<DeviceGroupRecord | null>;
  delete(id: string): Promise<boolean>;
  setDeviceGroups(deviceId: string, groupIds: string[]): Promise<void>;
}
