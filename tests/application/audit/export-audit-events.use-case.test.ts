import { describe, expect, test } from "bun:test";
import {
  ExportAuditEventsUseCase,
  ExportLimitExceededError,
} from "#/application/use-cases/audit";

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

describe("ExportAuditEventsUseCase", () => {
  test("streams filtered rows in chunks when below limit", async () => {
    const { repository, listCalls, countCalls } = makeRepository();
    const useCase = new ExportAuditEventsUseCase({
      auditEventRepository: repository,
      maxRows: 100,
      chunkSize: 25,
    });

    const chunks: unknown[] = [];
    for await (const chunk of useCase.execute({
      actorId: " user-1 ",
      status: 200.8,
      action: " rbac.user.update ",
    })) {
      chunks.push(chunk);
    }
    const result = chunks.flat();

    expect(result).toHaveLength(1);
    expect(listCalls).toHaveLength(1);
    expect(countCalls).toHaveLength(1);
    expect(listCalls[0]).toEqual({
      offset: 0,
      limit: 25,
      from: undefined,
      to: undefined,
      actorId: "user-1",
      actorType: undefined,
      action: "rbac.user.update",
      resourceType: undefined,
      resourceId: undefined,
      status: 200,
      requestId: undefined,
    });
  });

  test("throws ExportLimitExceededError when count exceeds max rows", async () => {
    const { repository } = makeRepository();
    const useCase = new ExportAuditEventsUseCase({
      auditEventRepository: {
        ...repository,
        count: async () => 101,
      },
      maxRows: 100,
    });

    await expect(
      (async () => {
        for await (const _chunk of useCase.execute({
          action: "rbac.user.update",
        })) {
          // no-op
        }
      })(),
    ).rejects.toBeInstanceOf(ExportLimitExceededError);
  });

  test("streams multiple pages when export spans more than one chunk", async () => {
    const listCalls: unknown[] = [];
    const useCase = new ExportAuditEventsUseCase({
      auditEventRepository: {
        create: async () => {
          throw new Error("unused");
        },
        list: async (query: { offset: number; limit: number }) => {
          listCalls.push(query);
          const remaining = Math.max(0, 5 - query.offset);
          const count = Math.min(query.limit, remaining);
          return Array.from({ length: count }, (_, idx) => ({
            id: `event-${query.offset + idx + 1}`,
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
          }));
        },
        count: async () => 5,
      },
      maxRows: 100,
      chunkSize: 2,
    });

    const items: Array<{ id: string }> = [];
    for await (const chunk of useCase.execute({ action: "rbac.user.update" })) {
      items.push(...chunk);
    }

    expect(items).toHaveLength(5);
    expect(listCalls).toHaveLength(3);
  });
});
