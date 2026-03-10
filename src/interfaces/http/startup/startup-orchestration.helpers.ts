import {
  logStartupPhaseFailed,
  logStartupPhaseStarted,
  logStartupPhaseSucceeded,
  type StartupPhaseContext,
} from "#/infrastructure/observability/startup-logging";

const normalizeUsername = (value: string): string => value.trim().toLowerCase();

export interface StartupRootIdentity {
  htshadowPath: string;
  username: string;
  email: string | null;
  password: string;
}

/**
 * Builds a startup context object for logging.
 */
export const buildStartupContext = (input: {
  runId: string;
  operation: string;
}): Omit<StartupPhaseContext, "operation"> & { operation: string } => ({
  component: "api-bootstrap",
  phase: "auth-identity",
  operation: input.operation,
  runId: input.runId,
});

/**
 * Wraps a startup phase action with logging.
 * Logs start, success, or failure with duration.
 */
export const runStartupPhase = async <T>(input: {
  context: StartupPhaseContext;
  action: () => Promise<T>;
  metadata?: Record<string, unknown>;
}): Promise<T> => {
  const startedAt = Date.now();
  logStartupPhaseStarted(input.context, input.metadata);
  try {
    const result = await input.action();
    logStartupPhaseSucceeded(
      input.context,
      Date.now() - startedAt,
      input.metadata,
    );
    return result;
  } catch (error) {
    logStartupPhaseFailed(
      input.context,
      Date.now() - startedAt,
      error,
      input.metadata,
    );
    throw error;
  }
};

/**
 * Normalizes root identity input by trimming and lowercasing.
 */
export const normalizeRootIdentity = (input: {
  htshadowPath: string;
  rootUsername: string;
  rootEmail: string | null;
  rootPassword: string;
}): StartupRootIdentity => ({
  htshadowPath: input.htshadowPath,
  username: normalizeUsername(input.rootUsername),
  email: input.rootEmail?.trim().toLowerCase() ?? null,
  password: input.rootPassword.trim(),
});

/**
 * Validates root identity input.
 * Throws if username/password is empty or email is invalid.
 */
export const validateRootIdentity = (
  rootIdentity: StartupRootIdentity,
): void => {
  if (!rootIdentity.username) {
    throw new Error("ROOT_USERNAME must not be empty.");
  }
  if (!rootIdentity.password) {
    throw new Error("ROOT_PASSWORD must not be empty.");
  }
  if (rootIdentity.email != null && !rootIdentity.email.includes("@")) {
    throw new Error("ROOT_EMAIL must be a valid email when provided.");
  }
};
