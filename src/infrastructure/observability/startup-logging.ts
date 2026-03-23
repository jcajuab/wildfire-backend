import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";

type StartupPhaseStatus = "started" | "succeeded" | "failed" | "degraded";

export interface StartupPhaseContext {
  runId: string;
  component: string;
  phase: string;
  operation: string;
}

interface StartupPhaseEventContext extends StartupPhaseContext {
  event: "startup.phase";
  status: StartupPhaseStatus;
  durationMs?: number;
}

export const createStartupRunId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID()}`;

const buildStartupPhasePayload = (
  context: StartupPhaseContext,
  status: StartupPhaseStatus,
  durationMs?: number,
  metadata?: Record<string, unknown>,
): StartupPhaseEventContext & Record<string, unknown> => ({
  event: "startup.phase",
  ...context,
  status,
  ...(durationMs != null ? { durationMs } : {}),
  ...(metadata ?? {}),
});

export const logStartupPhaseStarted = (
  context: StartupPhaseContext,
  metadata?: Record<string, unknown>,
): void => {
  logger.info(
    buildStartupPhasePayload(context, "started", undefined, metadata),
    `${context.operation} started`,
  );
};

export const logStartupPhaseSucceeded = (
  context: StartupPhaseContext,
  durationMs: number,
  metadata?: Record<string, unknown>,
): void => {
  logger.info(
    buildStartupPhasePayload(context, "succeeded", durationMs, metadata),
    `${context.operation} succeeded`,
  );
};

export const logStartupPhaseFailed = (
  context: StartupPhaseContext,
  durationMs: number,
  error: unknown,
  metadata?: Record<string, unknown>,
): void => {
  logger.error(
    addErrorContext(
      buildStartupPhasePayload(context, "failed", durationMs, metadata),
      error,
    ),
    `${context.operation} failed`,
  );
};

export const logStartupPhaseDegraded = (
  context: StartupPhaseContext,
  durationMs: number,
  message: string,
  metadata?: Record<string, unknown>,
  error?: unknown,
): void => {
  const payload = buildStartupPhasePayload(
    context,
    "degraded",
    durationMs,
    metadata,
  );
  if (error == null) {
    logger.warn(payload, message);
    return;
  }

  logger.warn(addErrorContext(payload, error), message);
};
