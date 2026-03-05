import { logger } from "#/infrastructure/observability/logger";

export type StartupPhaseStatus =
  | "started"
  | "succeeded"
  | "failed"
  | "degraded";

export interface StartupPhaseContext {
  runId: string;
  component: string;
  phase: string;
  operation: string;
}

export interface StartupPhaseEventContext extends StartupPhaseContext {
  status: StartupPhaseStatus;
  durationMs?: number;
}

const toErrorEvent = (
  error: unknown,
): { error: string; errorName: string; errorCode?: string } => {
  const safeError = error instanceof Error ? error : new Error(String(error));
  const code =
    safeError && typeof safeError === "object" && "code" in safeError
      ? String((safeError as { code?: unknown }).code)
      : undefined;
  return {
    error: safeError.message,
    errorName: safeError.name,
    ...(code && code.length > 0 ? { errorCode: code } : {}),
  };
};

export const createStartupRunId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID?.() ?? `fallback-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`}`;

export const buildStartupPhasePayload = (
  context: StartupPhaseContext,
  status: StartupPhaseStatus,
  durationMs?: number,
  metadata?: Record<string, unknown>,
): StartupPhaseEventContext & Record<string, unknown> => ({
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
    buildStartupPhasePayload(context, "failed", durationMs, {
      ...metadata,
      ...toErrorEvent(error),
    }),
    `${context.operation} failed`,
  );
};

export const logStartupPhaseDegraded = (
  context: StartupPhaseContext,
  durationMs: number,
  message: string,
  metadata?: Record<string, unknown>,
): void => {
  logger.warn(
    buildStartupPhasePayload(context, "degraded", durationMs, metadata),
    message,
  );
};

export const asSeedRunId = (): string => createStartupRunId("seed");
