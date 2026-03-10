import { type DisplayStatus } from "#/application/ports/displays";

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
export const DISPLAY_DOWN_TIMEOUT_MS = ONLINE_WINDOW_MS;

const isRecentlySeen = (lastSeenAt: string | null, now: Date): boolean => {
  const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
  return (
    Number.isFinite(lastSeenMs) &&
    now.getTime() - lastSeenMs <= ONLINE_WINDOW_MS
  );
};

export const deriveDisplayStatus = (input: {
  lastSeenAt: string | null;
  hasActivePlayback: boolean;
  now: Date;
}): DisplayStatus => {
  if (!isRecentlySeen(input.lastSeenAt, input.now)) {
    return input.lastSeenAt ? "DOWN" : "PROCESSING";
  }
  return input.hasActivePlayback ? "LIVE" : "READY";
};
