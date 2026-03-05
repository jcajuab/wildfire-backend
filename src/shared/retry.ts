export const sleep = (ms: number): Promise<void> => {
  const delayMs = Math.max(0, Math.floor(ms));
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

export const calculateExponentialDelayMs = (input: {
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
  factor?: number;
}): number => {
  const attempt = Math.max(1, Math.floor(input.attempt));
  const baseDelay = Math.max(1, Math.floor(input.baseDelayMs));
  const maxDelay = Math.max(baseDelay, Math.floor(input.maxDelayMs));
  const factor = input.factor === undefined ? 2 : Math.max(1.0, input.factor);
  const nextDelay = baseDelay * factor ** (attempt - 1);
  return Math.min(maxDelay, Math.floor(nextDelay));
};

export const withTimeout = <T>(
  operation: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  timeoutMs: number,
  operationName: string,
): Promise<T> => {
  const timeout = Math.max(1, Math.floor(timeoutMs));
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let didTimeout = false;
  let operationPromise: Promise<T>;

  return new Promise<T>((resolve, reject) => {
    try {
      operationPromise =
        typeof operation === "function"
          ? operation(controller.signal)
          : operation;
    } catch (error) {
      reject(error);
      return;
    }

    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
      reject(new Error(`${operationName} timed out after ${timeout}ms`));
    }, timeout);

    operationPromise
      .then((value) => {
        if (timeoutId != null) {
          clearTimeout(timeoutId);
        }
        resolve(value);
      })
      .catch((error) => {
        if (timeoutId != null) {
          clearTimeout(timeoutId);
        }
        if (didTimeout) {
          reject(new Error(`${operationName} timed out after ${timeout}ms`));
          return;
        }
        reject(error);
      });
  });
};
