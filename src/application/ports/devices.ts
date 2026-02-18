export interface DeviceRecord {
  id: string;
  name: string;
  identifier: string;
  location: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  outputType?: string | null;
  orientation?: "LANDSCAPE" | "PORTRAIT" | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceRepository {
  list(): Promise<DeviceRecord[]>;
  findByIds(ids: string[]): Promise<DeviceRecord[]>;
  findById(id: string): Promise<DeviceRecord | null>;
  findByIdentifier(identifier: string): Promise<DeviceRecord | null>;
  create(input: {
    name: string;
    identifier: string;
    location: string | null;
  }): Promise<DeviceRecord>;
  update(
    id: string,
    input: {
      name?: string;
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
}
