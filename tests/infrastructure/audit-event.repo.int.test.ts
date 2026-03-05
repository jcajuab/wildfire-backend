import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { setTestEnv } from "../helpers/env";
import {
  getIntegrationMySqlEnv,
  isRunIntegrationEnabled,
} from "../helpers/integration-env";

const runIntegration = isRunIntegrationEnabled();
const maybeTest = runIntegration ? test : test.skip;

const setup = async () => {
  setTestEnv(getIntegrationMySqlEnv());

  const { db } = await import("#/infrastructure/db/client");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS audit_events (
      id varchar(36) PRIMARY KEY,
      occurred_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      request_id varchar(128) NULL,
      action varchar(160) NOT NULL,
      route varchar(255) NULL,
      method varchar(10) NOT NULL,
      path varchar(255) NOT NULL,
      status int NOT NULL,
      actor_id varchar(36) NULL,
      actor_type varchar(16) NULL,
      resource_id varchar(36) NULL,
      resource_type varchar(120) NULL,
      ip_address varchar(64) NULL,
      user_agent varchar(255) NULL,
      metadata_json text NULL
    )
  `);
  await db.execute(sql`DELETE FROM audit_events`);
};

describe("AuditEventDbRepository (integration)", () => {
  maybeTest("creates and queries audit events", async () => {
    await setup();
    const { AuditEventDbRepository } = await import(
      "#/infrastructure/db/repositories/audit-event.repo"
    );

    const repo = new AuditEventDbRepository();
    const created = await repo.create({
      action: "rbac.user.update",
      route: "/users/:id",
      method: "PATCH",
      path: "/users/user-2",
      status: 200,
      actorId: "user-1",
      actorType: "user",
      resourceId: "user-2",
      resourceType: "user",
      requestId: "req-1",
      ipAddress: "127.0.0.1",
      userAgent: "test-agent",
    });

    expect(created.id).toBeDefined();
    expect(created.action).toBe("rbac.user.update");

    const list = await repo.list({
      offset: 0,
      limit: 20,
      actorId: "user-1",
    });
    expect(list.length).toBe(1);
    expect(list[0]?.requestId).toBe("req-1");

    const count = await repo.count({
      offset: 0,
      limit: 20,
      actorId: "user-1",
    });
    expect(count).toBe(1);
  });
});
