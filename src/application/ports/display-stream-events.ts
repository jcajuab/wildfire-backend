export type DisplayStreamEventType =
  | "manifest_updated"
  | "schedule_updated"
  | "playlist_updated"
  | "display_refresh_requested";

export interface DisplayStreamEventPublisher {
  publish(input: {
    type: DisplayStreamEventType;
    displayId: string;
    reason?: string;
    timestamp?: string;
  }): void;
}
