import { describe, expect, test } from "bun:test";
import { ListAuditEventsUseCase } from "#/application/use-cases/audit";

const makeRepository = () => {
  const listCalls: unknown[] = [];
  const countCalls: unknown[] = [];

  return {
    listCalls,
    countCalls,
    repository: {
      create: async () => {
        throw new Error("unused");
      },
      list: async (query: unknown) => {
        listCalls.push(query);
        return [
          {
            id: "event-1",
            occurredAt: "2026-01-01T00:00:00.000Z",
            requestId: "req-1",
            action: "rbac.user.update",
            route: "/users/:id",
            method: "PATCH",
            path: "/users/1",
            status: 200,
            actorId: "user-1",
            actorType: "user" as const,
            resourceId: "user-2",
            resourceType: "user",
            ipAddress: "127.0.0.1",
            userAgent: "agent",
            metadataJson: null,
          },
        ];
      },
      count: async (query: unknown) => {
        countCalls.push(query);
        return 1;
      },
    },
  };
};

describe("ListAuditEventsUseCase", () => {
  test("applies pagination defaults and returns paginated output", async () => {
    const { repository } = makeRepository();
    const useCase = new ListAuditEventsUseCase({
      auditEventRepository: repository,
    });

    const result = await useCase.execute({});

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  test("passes normalized filters to repository", async () => {
    const { repository, listCalls, countCalls } = makeRepository();
    const useCase = new ListAuditEventsUseCase({
      auditEventRepository: repository,
    });

    await useCase.execute({
      page: 2,
      pageSize: 1000,
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T00:00:00.000Z",
      actorId: " user-1 ",
      actorType: "user",
      action: " rbac.user.update ",
      resourceType: " user ",
      resourceId: " user-2 ",
      status: 200.7,
      requestId: " req-1 ",
    });

    expect(listCalls).toHaveLength(1);
    expect(countCalls).toHaveLength(1);
    expect(listCalls[0]).toEqual({
      offset: 200,
      limit: 200,
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T00:00:00.000Z",
      actorId: "user-1",
      actorType: "user",
      action: "rbac.user.update",
      resourceType: "user",
      resourceId: "user-2",
      status: 200,
      requestId: "req-1",
    });
  });

  test("throws when from is after to", async () => {
    const { repository } = makeRepository();
    const useCase = new ListAuditEventsUseCase({
      auditEventRepository: repository,
    });

    await expect(
      useCase.execute({
        from: "2026-02-01T00:00:00.000Z",
        to: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("from must be before or equal to to");
  });

  test("throws when actorType is invalid", async () => {
    const { repository } = makeRepository();
    const useCase = new ListAuditEventsUseCase({
      auditEventRepository: repository,
    });

    await expect(
      useCase.execute({
        actorType: "admin",
      }),
    ).rejects.toThrow("actorType must be one of: user, device");
  });
});
