import { asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import {
  type RoleRecord,
  type RoleRepository,
  type RoleWithUserCount,
} from "#/application/ports/rbac";
import { ADMIN_ROLE_NAME } from "#/domain/rbac/canonical-permissions";
import { db } from "#/infrastructure/db/client";
import { roles, userRoles } from "#/infrastructure/db/schema/rbac.sql";
import { buildLikeContainsPattern } from "#/infrastructure/db/utils/sql";

const withIsSystem = (role: {
  id: string;
  name: string;
  description: string | null;
}): RoleRecord => ({
  ...role,
  isSystem: role.name === ADMIN_ROLE_NAME,
});

export class RoleDbRepository implements RoleRepository {
  async list(): Promise<RoleRecord[]> {
    const rows = await db.select().from(roles);
    return rows.map(withIsSystem);
  }

  async listOptions(input: {
    q?: string;
    limit?: number;
  }): Promise<RoleRecord[]> {
    const normalizedQuery = input.q?.trim();
    const whereClause = normalizedQuery
      ? or(
          like(roles.name, buildLikeContainsPattern(normalizedQuery)),
          like(roles.description, buildLikeContainsPattern(normalizedQuery)),
        )
      : undefined;
    const limit = Math.max(1, input.limit ?? 100);

    const rows = await db
      .select()
      .from(roles)
      .where(whereClause)
      .orderBy(asc(roles.name))
      .limit(limit);

    return rows.map(withIsSystem);
  }

  async listPageWithUserCount(input: {
    offset: number;
    limit: number;
    q?: string;
    sortBy?: "name" | "usersCount";
    sortDirection?: "asc" | "desc";
  }): Promise<{ items: RoleWithUserCount[]; total: number }> {
    const normalizedQuery = input.q?.trim();
    const whereClause = normalizedQuery
      ? or(
          like(roles.name, buildLikeContainsPattern(normalizedQuery)),
          like(roles.description, buildLikeContainsPattern(normalizedQuery)),
        )
      : undefined;

    const usersCountSql = sql<number>`count(${userRoles.userId})`;
    const orderBy =
      input.sortBy === "usersCount"
        ? ([
            input.sortDirection === "asc"
              ? asc(usersCountSql)
              : desc(usersCountSql),
            input.sortDirection === "desc" ? desc(roles.name) : asc(roles.name),
          ] as const)
        : ([
            input.sortDirection === "desc" ? desc(roles.name) : asc(roles.name),
          ] as const);
    const rows = await db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        usersCount: usersCountSql,
      })
      .from(roles)
      .leftJoin(userRoles, eq(userRoles.roleId, roles.id))
      .where(whereClause)
      .groupBy(roles.id, roles.name, roles.description)
      .orderBy(...orderBy)
      .limit(input.limit)
      .offset(input.offset);

    const totalQuery = db.select({ value: sql<number>`count(*)` }).from(roles);
    const totalResult =
      whereClause == null
        ? await totalQuery
        : await totalQuery.where(whereClause);

    return {
      items: rows.map((row) => ({
        ...withIsSystem(row),
        usersCount: Number(row.usersCount),
      })),
      total: Number(totalResult[0]?.value ?? 0),
    };
  }

  async findById(id: string): Promise<RoleRecord | null> {
    const result = await db
      .select()
      .from(roles)
      .where(eq(roles.id, id))
      .limit(1);
    return result[0] ? withIsSystem(result[0]) : null;
  }

  async findByIds(ids: string[]): Promise<RoleRecord[]> {
    if (ids.length === 0) return [];
    const rows = await db.select().from(roles).where(inArray(roles.id, ids));
    return rows.map(withIsSystem);
  }

  async findByName(name: string): Promise<RoleRecord | null> {
    const result = await db
      .select()
      .from(roles)
      .where(eq(roles.name, name))
      .limit(1);
    return result[0] ? withIsSystem(result[0]) : null;
  }

  async create(input: {
    name: string;
    description?: string | null;
  }): Promise<RoleRecord> {
    const id = crypto.randomUUID();
    const description = input.description ?? null;

    await db.insert(roles).values({
      id,
      name: input.name,
      description,
    });

    return withIsSystem({ id, name: input.name, description });
  }

  async update(
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<RoleRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const next = {
      name: input.name ?? existing.name,
      description:
        input.description !== undefined
          ? (input.description ?? null)
          : existing.description,
    };

    await db
      .update(roles)
      .set({
        name: next.name,
        description: next.description,
      })
      .where(eq(roles.id, id));

    return withIsSystem({ ...existing, ...next });
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(roles).where(eq(roles.id, id));
    return (result[0]?.affectedRows ?? 0) > 0;
  }
}
