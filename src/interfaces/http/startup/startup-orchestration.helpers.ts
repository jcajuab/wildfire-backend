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

export const buildStartupContext = (input: {
  runId: string;
  operation: string;
}): Omit<StartupPhaseContext, "operation"> & { operation: string } => ({
  component: "api-bootstrap",
  phase: "auth-identity",
  operation: input.operation,
  runId: input.runId,
});

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
