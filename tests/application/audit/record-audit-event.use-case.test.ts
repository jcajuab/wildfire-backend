import { describe, expect, test } from "bun:test";
import { type CreateAuditEventInput } from "#/application/ports/audit";
import { RecordAuditEventUseCase } from "#/application/use-cases/audit";

const makeRepository = () => {
  const calls: CreateAuditEventInput[] = [];

  return {
    calls,
    repository: {
      create: async (input: CreateAuditEventInput) => {
        calls.push(input);
        return {
          id: "event-1",
          occurredAt: "2026-01-01T00:00:00.000Z",
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
          metadataJson: input.metadataJson ?? null,
        };
      },
      list: async () => [],
      count: async () => 0,
    },
  };
};

describe("RecordAuditEventUseCase", () => {
  test("normalizes and writes audit metadata-only event", async () => {
    const { calls, repository } = makeRepository();
    const useCase = new RecordAuditEventUseCase({
      auditEventRepository: repository,
    });

    const result = await useCase.execute({
      requestId: " req-1 ",
      action: " rbac.user.update ",
      route: " /users/:id ",
      method: "patch",
      path: " /users/1 ",
      status: 200.8,
      actorId: " user-1 ",
      actorType: "user",
      resourceId: " user-2 ",
      resourceType: " user ",
      ipAddress: " 127.0.0.1 ",
      userAgent: " Mozilla ",
      metadataJson: '{"secret":"value"}',
    });

    expect(result.id).toBe("event-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      requestId: "req-1",
      action: "rbac.user.update",
      route: "/users/:id",
      method: "PATCH",
      path: "/users/1",
      status: 200,
      actorId: "user-1",
      actorType: "user",
      resourceId: "user-2",
      resourceType: "user",
      ipAddress: "127.0.0.1",
      userAgent: "Mozilla",
      metadataJson: '{"secret":"[REDACTED]"}',
      occurredAt: undefined,
    });
  });

  test("throws when metadataJson is not valid JSON", async () => {
    const { repository } = makeRepository();
    const useCase = new RecordAuditEventUseCase({
      auditEventRepository: repository,
    });

    await expect(
      useCase.execute({
        action: "rbac.user.update",
        method: "PATCH",
        path: "/users/1",
        status: 200,
        metadataJson: "{not-json}",
      }),
    ).rejects.toThrow("metadataJson must be valid JSON");
  });

  test("throws when action is empty", async () => {
    const { repository } = makeRepository();
    const useCase = new RecordAuditEventUseCase({
      auditEventRepository: repository,
    });

    await expect(
      useCase.execute({
        action: "  ",
        method: "POST",
        path: "/users",
        status: 201,
      }),
    ).rejects.toThrow("action is required");
  });

  test("throws when status is outside HTTP range", async () => {
    const { repository } = makeRepository();
    const useCase = new RecordAuditEventUseCase({
      auditEventRepository: repository,
    });

    await expect(
      useCase.execute({
        action: "rbac.user.create",
        method: "POST",
        path: "/users",
        status: 99,
      }),
    ).rejects.toThrow("status must be between 100 and 599");
  });
});
