import { describe, expect, test } from "bun:test";
import { type AuditLogRepository } from "#/application/ports/audit";
import { FlushAuditLogsUseCase } from "#/application/use-cases/audit";

const makeRepository = () => {
  const deleteBeforeCalls: Date[] = [];
  let deleteAllCalls = 0;

  const repository: AuditLogRepository = {
    create: async () => ({
      id: "",
      occurredAt: "",
      requestId: null,
      action: "",
      route: null,
      method: "",
      path: "",
      status: 0,
      actorId: null,
      actorType: null,
      resourceId: null,
      resourceType: null,
      ipAddress: null,
      userAgent: null,
      metadataJson: null,
    }),
    list: async () => [],
    listWithActors: async () => [],
    count: async () => 0,
    deleteBefore: async (cutoff: Date) => {
      deleteBeforeCalls.push(cutoff);
      return 3;
    },
    deleteAll: async () => {
      deleteAllCalls += 1;
      return 5;
    },
    deleteByRequestIdPrefix: async () => 0,
  };

  return {
    repository,
    deleteBeforeCalls,
    getDeleteAllCalls: () => deleteAllCalls,
  };
};

describe("FlushAuditLogsUseCase", () => {
  test("deletes audit logs older than a relative day range", async () => {
    const { repository, deleteBeforeCalls } = makeRepository();
    const useCase = new FlushAuditLogsUseCase({
      auditLogRepository: repository,
      now: () => new Date("2026-05-10T13:45:00.000Z"),
    });

    const result = await useCase.execute({ mode: "olderThanDays", days: 30 });

    expect(result.deleted).toBe(3);
    expect(deleteBeforeCalls).toHaveLength(1);
    expect(deleteBeforeCalls[0]?.toISOString()).toBe(
      "2026-04-10T00:00:00.000Z",
    );
  });

  test("deletes audit logs before a custom date", async () => {
    const { repository, deleteBeforeCalls } = makeRepository();
    const useCase = new FlushAuditLogsUseCase({
      auditLogRepository: repository,
    });

    const result = await useCase.execute({
      mode: "beforeDate",
      date: "2026-05-01",
    });

    expect(result.deleted).toBe(3);
    expect(deleteBeforeCalls[0]?.toISOString()).toBe(
      "2026-05-01T00:00:00.000Z",
    );
  });

  test("deletes all audit logs", async () => {
    const { repository, getDeleteAllCalls } = makeRepository();
    const useCase = new FlushAuditLogsUseCase({
      auditLogRepository: repository,
    });

    const result = await useCase.execute({ mode: "all" });

    expect(result.deleted).toBe(5);
    expect(getDeleteAllCalls()).toBe(1);
  });

  test("rejects invalid custom dates", async () => {
    const { repository } = makeRepository();
    const useCase = new FlushAuditLogsUseCase({
      auditLogRepository: repository,
    });

    await expect(
      useCase.execute({ mode: "beforeDate", date: "2026-02-31" }),
    ).rejects.toThrow("date must be a valid date");
  });
});
