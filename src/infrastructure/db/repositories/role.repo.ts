import { eq, inArray } from "drizzle-orm";
import { type RoleRecord, type RoleRepository } from "#/application/ports/rbac";
import { ADMIN_ROLE_NAME } from "#/domain/rbac/canonical-permissions";
import { db } from "#/infrastructure/db/client";
import { roles } from "#/infrastructure/db/schema/rbac.sql";

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
