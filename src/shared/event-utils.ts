import { logger } from "#/infrastructure/observability/logger";

export const isStringField = (
  value: unknown,
  maxBytes: number,
): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= maxBytes;

export const makeLogInvalidEnvelope = (config: {
  component: string;
  event: string;
  previewBytes: number;
  message: string;
  cooldownMs: number;
}): ((reason: string, channel: string, rawMessage: string) => void) => {
  let lastLogMs = 0;
  return (reason: string, channel: string, rawMessage: string): void => {
    const now = Date.now();
    if (now - lastLogMs < config.cooldownMs) {
      return;
    }
    lastLogMs = now;
    logger.warn(
      {
        component: config.component,
        event: config.event,
        channel,
        reason,
        messageBytes: Buffer.byteLength(rawMessage),
        messagePreview: rawMessage.slice(0, config.previewBytes),
      },
      config.message,
    );
  };
};
