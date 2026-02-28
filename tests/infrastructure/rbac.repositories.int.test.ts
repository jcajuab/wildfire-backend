import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { setTestEnv } from "../helpers/env";

const runIntegration = process.env.RUN_INTEGRATION === "true";
const maybeTest = runIntegration ? test : test.skip;

const setup = async () => {
  setTestEnv({
    MYSQL_HOST: process.env.MYSQL_HOST ?? "127.0.0.1",
    MYSQL_PORT: process.env.MYSQL_PORT ?? "3306",
    MYSQL_DATABASE: process.env.MYSQL_DATABASE ?? "wildfire_test",
    MYSQL_USER: process.env.MYSQL_USER ?? "wildfire",
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ?? "wildfire",
  });

  const { db } = await import("#/infrastructure/db/client");
  const schema = await import("#/infrastructure/db/schema/rbac.sql");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id varchar(36) PRIMARY KEY,
      email varchar(255) NOT NULL,
      name varchar(255) NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS roles (
      id varchar(36) PRIMARY KEY,
      name varchar(120) NOT NULL,
      description text NULL,
      is_system boolean NOT NULL DEFAULT false
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS permissions (
      id varchar(36) PRIMARY KEY,
      resource varchar(120) NOT NULL,
      action varchar(120) NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id varchar(36) NOT NULL,
      role_id varchar(36) NOT NULL,
      PRIMARY KEY (user_id, role_id)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id varchar(36) NOT NULL,
      permission_id varchar(36) NOT NULL,
      PRIMARY KEY (role_id, permission_id)
    )
  `);

  await db.execute(sql`DELETE FROM role_permissions`);
  await db.execute(sql`DELETE FROM user_roles`);
  await db.execute(sql`DELETE FROM permissions`);
  await db.execute(sql`DELETE FROM roles`);
  await db.execute(sql`DELETE FROM users`);

  return { db, schema };
};

describe("RBAC repositories (integration)", () => {
  maybeTest("UserDbRepository CRUD", async () => {
    await setup();
    const { UserDbRepository } = await import(
      "#/infrastructure/db/repositories/user.repo"
    );

    const repo = new UserDbRepository();
    const created = await repo.create({
      email: "user@example.com",
      name: "User",
    });

    expect(created.email).toBe("user@example.com");
    expect(created.isActive).toBe(true);

    const found = await repo.findById(created.id);
    expect(found?.id).toBe(created.id);

    const foundByEmail = await repo.findByEmail("user@example.com");
    expect(foundByEmail?.id).toBe(created.id);

    const updated = await repo.update(created.id, { name: "Updated" });
    expect(updated?.name).toBe("Updated");

    const list = await repo.list();
    expect(list.length).toBe(1);

    const deleted = await repo.delete(created.id);
    expect(deleted).toBe(true);
  });

  maybeTest("RoleDbRepository CRUD", async () => {
    await setup();
    const { RoleDbRepository } = await import(
      "#/infrastructure/db/repositories/role.repo"
    );

    const repo = new RoleDbRepository();
    const created = await repo.create({ name: "Admin" });
    expect(created.description).toBeNull();

    const found = await repo.findById(created.id);
    expect(found?.id).toBe(created.id);

    const updated = await repo.update(created.id, { description: "All" });
    expect(updated?.description).toBe("All");

    const list = await repo.list();
    expect(list.length).toBe(1);

    const deleted = await repo.delete(created.id);
    expect(deleted).toBe(true);
  });

  maybeTest("PermissionDbRepository CRUD", async () => {
    await setup();
    const { PermissionDbRepository } = await import(
      "#/infrastructure/db/repositories/permission.repo"
    );

    const repo = new PermissionDbRepository();
    const created = await repo.create({ resource: "content", action: "read" });
    expect(created.resource).toBe("content");

    const list = await repo.list();
    expect(list.length).toBe(1);

    const found = await repo.findByIds([created.id]);
    expect(found.length).toBe(1);

    const empty = await repo.findByIds([]);
    expect(empty).toEqual([]);
  });

  maybeTest("UserRoleDbRepository set/list", async () => {
    const { schema, db } = await setup();
    const { UserRoleDbRepository } = await import(
      "#/infrastructure/db/repositories/user-role.repo"
    );

    await db.insert(schema.users).values({
      id: "user-1",
      email: "user@example.com",
      name: "User",
      isActive: true,
    });
    await db.insert(schema.roles).values({
      id: "role-1",
      name: "Admin",
      description: null,
      isSystem: false,
    });

    const repo = new UserRoleDbRepository();
    await repo.setUserRoles("user-1", ["role-1"]);
    const roles = await repo.listRolesByUserId("user-1");

    expect(roles).toEqual([{ userId: "user-1", roleId: "role-1" }]);
  });

  maybeTest("RolePermissionDbRepository set/list", async () => {
    const { schema, db } = await setup();
    const { RolePermissionDbRepository } = await import(
      "#/infrastructure/db/repositories/role-permission.repo"
    );

    await db.insert(schema.roles).values({
      id: "role-1",
      name: "Admin",
      description: null,
      isSystem: false,
    });
    await db.insert(schema.permissions).values({
      id: "perm-1",
      resource: "content",
      action: "read",
    });

    const repo = new RolePermissionDbRepository();
    await repo.setRolePermissions("role-1", ["perm-1"]);
    const permissions = await repo.listPermissionsByRoleId("role-1");

    expect(permissions).toEqual([{ roleId: "role-1", permissionId: "perm-1" }]);
  });

  maybeTest("AuthorizationDbRepository returns permissions", async () => {
    await setup();
    const { AuthorizationDbRepository } = await import(
      "#/infrastructure/db/repositories/authorization.repo"
    );
    const { PermissionDbRepository } = await import(
      "#/infrastructure/db/repositories/permission.repo"
    );
    const { RoleDbRepository } = await import(
      "#/infrastructure/db/repositories/role.repo"
    );
    const { UserDbRepository } = await import(
      "#/infrastructure/db/repositories/user.repo"
    );
    const { UserRoleDbRepository } = await import(
      "#/infrastructure/db/repositories/user-role.repo"
    );
    const { RolePermissionDbRepository } = await import(
      "#/infrastructure/db/repositories/role-permission.repo"
    );

    const userRepo = new UserDbRepository();
    const roleRepo = new RoleDbRepository();
    const permissionRepo = new PermissionDbRepository();
    const userRoleRepo = new UserRoleDbRepository();
    const rolePermissionRepo = new RolePermissionDbRepository();

    const user = await userRepo.create({
      email: "user@example.com",
      name: "User",
    });
    const role = await roleRepo.create({ name: "Admin" });
    const permission = await permissionRepo.create({
      resource: "content",
      action: "read",
    });

    await userRoleRepo.setUserRoles(user.id, [role.id]);
    await rolePermissionRepo.setRolePermissions(role.id, [permission.id]);

    const repo = new AuthorizationDbRepository();
    const result = await repo.findPermissionsForUser(user.id);

    const values = result.map((item) => `${item.resource}:${item.action}`);
    expect(values).toEqual(["content:read"]);

    const missing = await repo.findPermissionsForUser("missing-user");
    expect(missing).toEqual([]);
  });
});
