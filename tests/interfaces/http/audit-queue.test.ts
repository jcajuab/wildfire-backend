import { describe, expect, test } from "bun:test";
import { RedisAuditQueue } from "#/interfaces/http/audit/redis-audit-queue";

const buildEvent = () => ({
  action: "rbac.role.update",
  method: "PATCH",
  path: "/roles/role-1",
  status: 200,
  requestId: "req-1",
});

describe("RedisAuditQueue", () => {
  test("drops enqueue when disabled", async () => {
    const queue = new RedisAuditQueue({
      enabled: false,
      maxStreamLength: 10,
      streamName: "wf:stream:audit:test",
      enqueueMaxAttempts: 1,
      enqueueBaseDelayMs: 0,
      enqueueMaxDelayMs: 0,
      enqueueTimeoutMs: 100,
    });

    expect(await queue.enqueue(buildEvent())).toEqual({
      accepted: false,
      reason: "disabled",
    });
    expect(queue.getStats()).toEqual({
      queued: 0,
      dropped: 0,
      flushed: 0,
      failed: 0,
    });
  });

  test("drops enqueue after stop", async () => {
    const queue = new RedisAuditQueue({
      enabled: true,
      maxStreamLength: 10,
      streamName: "wf:stream:audit:test",
      enqueueMaxAttempts: 1,
      enqueueBaseDelayMs: 0,
      enqueueMaxDelayMs: 0,
      enqueueTimeoutMs: 100,
    });

    await queue.stop();

    expect(await queue.enqueue(buildEvent())).toEqual({
      accepted: false,
      reason: "disabled",
    });
  });
});
