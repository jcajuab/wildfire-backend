export type DeviceStreamEventType =
  | "manifest_updated"
  | "schedule_updated"
  | "playlist_updated"
  | "device_refresh_requested";

export interface DeviceStreamEventPublisher {
  publish(input: {
    type: DeviceStreamEventType;
    deviceId: string;
    reason?: string;
    timestamp?: string;
  }): void;
}
