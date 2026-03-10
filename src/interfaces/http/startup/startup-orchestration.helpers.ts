import {
  logStartupPhaseFailed,
  logStartupPhaseStarted,
  logStartupPhaseSucceeded,
  type StartupPhaseContext,
} from "#/infrastructure/observability/startup-logging";

const normalizeUsername = (value: string): string => value.trim().toLowerCase();

export interface StartupAdminIdentity {
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
 * Normalizes admin identity input by trimming and lowercasing.
 */
export const normalizeAdminIdentity = (input: {
  htshadowPath: string;
  adminUsername: string;
  adminEmail: string | null;
  adminPassword: string;
}): StartupAdminIdentity => ({
  htshadowPath: input.htshadowPath,
  username: normalizeUsername(input.adminUsername),
  email: input.adminEmail?.trim().toLowerCase() ?? null,
  password: input.adminPassword.trim(),
});

/**
 * Validates admin identity input.
 * Throws if username/password is empty or email is invalid.
 */
export const validateAdminIdentity = (
  adminIdentity: StartupAdminIdentity,
): void => {
  if (!adminIdentity.username) {
    throw new Error("ADMIN_USERNAME must not be empty.");
  }
  if (!adminIdentity.password) {
    throw new Error("ADMIN_PASSWORD must not be empty.");
  }
  if (adminIdentity.email != null && !adminIdentity.email.includes("@")) {
    throw new Error("ADMIN_EMAIL must be a valid email when provided.");
  }
};
