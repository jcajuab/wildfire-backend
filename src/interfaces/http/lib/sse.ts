const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

type SseFrame = string | Uint8Array;

export interface SseStreamHandle {
  send(frame: SseFrame): void;
  close(): void;
}

export const createSseResponse = (
  stream: ReadableStream<Uint8Array>,
): Response => new Response(stream, { status: 200, headers: SSE_HEADERS });

export const createSseStream = (input: {
  heartbeatIntervalMs: number;
  start: (handle: SseStreamHandle) => undefined | (() => void);
}): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let isClosed = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null =
    null;

  const closeController = (): void => {
    if (!streamController) {
      return;
    }

    try {
      streamController.close();
    } catch {
      // Ignore repeated close attempts after stream teardown.
    }
  };

  const close = (): void => {
    if (isClosed) {
      return;
    }

    isClosed = true;
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const send = (frame: SseFrame): void => {
    if (isClosed || !streamController) {
      return;
    }

    try {
      streamController.enqueue(
        typeof frame === "string" ? encoder.encode(frame) : frame,
      );
    } catch {
      close();
      closeController();
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      const teardown = input.start({ send, close });
      cleanup = typeof teardown === "function" ? teardown : null;
      heartbeat = setInterval(() => {
        send(": heartbeat\n\n");
      }, input.heartbeatIntervalMs);
    },
    cancel() {
      close();
      closeController();
    },
  });
};
