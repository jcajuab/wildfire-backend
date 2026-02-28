export const DISPLAY_RUNTIME_SCROLL_PX_PER_SECOND_KEY =
  "display_runtime_scroll_px_per_second" as const;

export interface SystemSettingRecord {
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface SystemSettingRepository {
  findByKey(key: string): Promise<SystemSettingRecord | null>;
  upsert(input: { key: string; value: string }): Promise<SystemSettingRecord>;
}
