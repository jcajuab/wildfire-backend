export interface DeviceRecord {
  id: string;
  name: string;
  identifier: string;
  location: string | null;
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
    input: { name?: string; location?: string | null },
  ): Promise<DeviceRecord | null>;
}
