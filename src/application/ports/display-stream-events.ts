import { type DisplayStatus } from "#/application/ports/displays";

export type DisplayStreamEventType =
  | "manifest_updated"
  | "schedule_updated"
  | "playlist_updated"
  | "display_refresh_requested";

export interface DisplayStreamEvent {
  type: DisplayStreamEventType;
  displayId: string;
  timestamp: string;
  reason?: string;
}

export interface DisplayStreamPublishInput {
  type: DisplayStreamEventType;
  displayId: string;
  reason?: string;
  timestamp?: string;
}

export interface DisplayStreamEventPublisher {
  publish(input: DisplayStreamPublishInput): void;
}

export interface DisplayStreamEventSubscription {
  subscribe(
    displayId: string,
    handler: (event: DisplayStreamEvent) => void,
  ): () => void;
}

export interface AdminDisplayLifecycleEventPublisher {
  publish(
    input:
      | {
          type: "display_registered";
          displayId: string;
          slug: string;
          occurredAt: string;
        }
      | {
          type: "display_unregistered";
          displayId: string;
          slug: string;
          occurredAt: string;
        }
      | {
          type: "display_status_changed";
          displayId: string;
          slug: string;
          previousStatus: "PROCESSING" | "READY" | "LIVE" | "DOWN";
          status: "PROCESSING" | "READY" | "LIVE" | "DOWN";
          occurredAt: string;
        },
  ): void;
}

export type AdminDisplayLifecycleEvent =
  | {
      type: "display_registered";
      displayId: string;
      slug: string;
      occurredAt: string;
    }
  | {
      type: "display_unregistered";
      displayId: string;
      slug: string;
      occurredAt: string;
    }
  | {
      type: "display_status_changed";
      displayId: string;
      slug: string;
      previousStatus: DisplayStatus;
      status: DisplayStatus;
      occurredAt: string;
    };

export interface AdminDisplayLifecycleEventSubscription {
  subscribe(handler: (event: AdminDisplayLifecycleEvent) => void): () => void;
}
