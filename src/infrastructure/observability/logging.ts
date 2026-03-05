export interface LogErrorContext {
  name: string;
  message: string;
  code?: string;
  stack?: string;
}

const resolveErrorCode = (error: unknown): string | undefined => {
  const candidates = [
    "code",
    "Code",
    "errno",
    "status",
    "statusCode",
    "httpStatusCode",
  ] as const;

  for (const candidate of candidates) {
    if (typeof error !== "object" || error == null) {
      return undefined;
    }

    const value = (error as Record<string, unknown>)[candidate];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
};

export const normalizeLogError = (error: unknown): LogErrorContext => {
  const normalizedError =
    error instanceof Error
      ? error
      : new Error(String(error ?? "Unknown error"));
  const code =
    typeof normalizedError === "object"
      ? resolveErrorCode(normalizedError)
      : undefined;

  return {
    name: normalizedError.name,
    message: normalizedError.message,
    ...(code != null ? { code } : {}),
    ...(normalizedError.stack != null && normalizedError.stack.length > 0
      ? { stack: normalizedError.stack }
      : {}),
  };
};

export const addErrorContext = <T extends Record<string, unknown>>(
  payload: T,
  error: unknown,
): T & { error: LogErrorContext } => ({
  ...payload,
  error: normalizeLogError(error),
});
