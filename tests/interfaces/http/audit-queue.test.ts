import { describe, expect, test } from "bun:test";
import { RecordAuditEventUseCase } from "#/application/use-cases/audit";
import { InMemoryAuditQueue } from "#/interfaces/http/audit/in-memory-audit-queue";

const buildEvent = (id: string) => ({
  action: "rbac.user.update",
  method: "PATCH",
  path: `/users/${id}`,
  status: 200,
  requestId: `req-${id}`,
});

describe("InMemoryAuditQueue", () => {
  test("enqueues and flushes events", async () => {
    const calls: string[] = [];
    const queue = new InMemoryAuditQueue(
      {
        enabled: true,
        capacity: 10,
        flushBatchSize: 2,
        flushIntervalMs: 10_000,
      },
      {
        recordAuditEvent: new RecordAuditEventUseCase({
          auditEventRepository: {
            create: async (input) => {
              calls.push(input.requestId ?? "unknown");
              return {
                id: crypto.randomUUID(),
                occurredAt: new Date().toISOString(),
                requestId: input.requestId ?? null,
                action: input.action,
                route: input.route ?? null,
                method: input.method,
                path: input.path,
                status: input.status,
                actorId: input.actorId ?? null,
                actorType: input.actorType ?? null,
                resourceId: input.resourceId ?? null,
                resourceType: input.resourceType ?? null,
                ipAddress: input.ipAddress ?? null,
                userAgent: input.userAgent ?? null,
                metadataJson: null,
              };
            },
            list: async () => [],
            count: async () => 0,
          },
        }),
      },
    );

    expect(queue.enqueue(buildEvent("1")).accepted).toBe(true);
    expect(queue.enqueue(buildEvent("2")).accepted).toBe(true);
    await queue.flushNow();

    expect(calls).toEqual(["req-1", "req-2"]);
    expect(queue.getStats().queued).toBe(0);

    await queue.stop();
  });

  test("drops events when queue overflows", async () => {
    const queue = new InMemoryAuditQueue(
      {
        enabled: true,
        capacity: 1,
        flushBatchSize: 1,
        flushIntervalMs: 10_000,
      },
      {
        recordAuditEvent: new RecordAuditEventUseCase({
          auditEventRepository: {
            create: async (input) => ({
              id: crypto.randomUUID(),
              occurredAt: new Date().toISOString(),
              requestId: input.requestId ?? null,
              action: input.action,
              route: input.route ?? null,
              method: input.method,
              path: input.path,
              status: input.status,
              actorId: input.actorId ?? null,
              actorType: input.actorType ?? null,
              resourceId: input.resourceId ?? null,
              resourceType: input.resourceType ?? null,
              ipAddress: input.ipAddress ?? null,
              userAgent: input.userAgent ?? null,
              metadataJson: null,
            }),
            list: async () => [],
            count: async () => 0,
          },
        }),
      },
    );

    expect(queue.enqueue(buildEvent("1"))).toEqual({ accepted: true });
    expect(queue.enqueue(buildEvent("2"))).toEqual({
      accepted: false,
      reason: "overflow",
    });
    expect(queue.getStats().dropped).toBe(1);
    await queue.stop();
  });

  test("retries pending items when flush fails", async () => {
    let shouldFail = true;
    const queue = new InMemoryAuditQueue(
      {
        enabled: true,
        capacity: 5,
        flushBatchSize: 5,
        flushIntervalMs: 10_000,
      },
      {
        recordAuditEvent: new RecordAuditEventUseCase({
          auditEventRepository: {
            create: async (input) => {
              if (shouldFail && input.requestId === "req-1") {
                shouldFail = false;
                throw new Error("temporary failure");
              }
              return {
                id: crypto.randomUUID(),
                occurredAt: new Date().toISOString(),
                requestId: input.requestId ?? null,
                action: input.action,
                route: input.route ?? null,
                method: input.method,
                path: input.path,
                status: input.status,
                actorId: input.actorId ?? null,
                actorType: input.actorType ?? null,
                resourceId: input.resourceId ?? null,
                resourceType: input.resourceType ?? null,
                ipAddress: input.ipAddress ?? null,
                userAgent: input.userAgent ?? null,
                metadataJson: null,
              };
            },
            list: async () => [],
            count: async () => 0,
          },
        }),
      },
    );

    queue.enqueue(buildEvent("1"));
    queue.enqueue(buildEvent("2"));
    await queue.flushNow();
    expect(queue.getStats().queued).toBeGreaterThan(0);

    await queue.flushNow();
    expect(queue.getStats().queued).toBe(0);
    expect(queue.getStats().failed).toBe(1);
    await queue.stop();
  });

  test("stop waits for in-flight flush to finish", async () => {
    let releaseFlush!: () => void;
    let startedFlush!: () => void;
    const flushStarted = new Promise<void>((resolve) => {
      startedFlush = resolve;
    });
    const canFinishFlush = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });

    const queue = new InMemoryAuditQueue(
      {
        enabled: true,
        capacity: 5,
        flushBatchSize: 5,
        flushIntervalMs: 10_000,
      },
      {
        recordAuditEvent: new RecordAuditEventUseCase({
          auditEventRepository: {
            create: async (input) => {
              startedFlush();
              await canFinishFlush;
              return {
                id: crypto.randomUUID(),
                occurredAt: new Date().toISOString(),
                requestId: input.requestId ?? null,
                action: input.action,
                route: input.route ?? null,
                method: input.method,
                path: input.path,
                status: input.status,
                actorId: input.actorId ?? null,
                actorType: input.actorType ?? null,
                resourceId: input.resourceId ?? null,
                resourceType: input.resourceType ?? null,
                ipAddress: input.ipAddress ?? null,
                userAgent: input.userAgent ?? null,
                metadataJson: null,
              };
            },
            list: async () => [],
            count: async () => 0,
          },
        }),
      },
    );

    queue.enqueue(buildEvent("1"));
    const flushPromise = queue.flushNow();
    await flushStarted;

    let stopResolved = false;
    const stopPromise = queue.stop().then(() => {
      stopResolved = true;
    });

    await Promise.resolve();
    expect(stopResolved).toBe(false);

    releaseFlush();
    await stopPromise;
    await flushPromise;
    expect(queue.getStats().queued).toBe(0);
  });
});
