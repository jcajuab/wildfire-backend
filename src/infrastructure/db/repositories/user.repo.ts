import { eq, inArray } from "drizzle-orm";
import { type UserRecord, type UserRepository } from "#/application/ports/rbac";
import { db } from "#/infrastructure/db/client";
import { users } from "#/infrastructure/db/schema/rbac.sql";

const toRecord = (row: typeof users.$inferSelect): UserRecord => ({
  id: row.id,
  email: row.email,
  name: row.name,
  isActive: row.isActive,
  timezone: row.timezone ?? null,
  avatarKey: row.avatarKey ?? null,
  lastSeenAt:
    row.lastSeenAt == null
      ? null
      : row.lastSeenAt instanceof Date
        ? row.lastSeenAt.toISOString()
        : row.lastSeenAt,
});

export class UserDbRepository implements UserRepository {
  async list(): Promise<UserRecord[]> {
    const rows = await db.select().from(users);
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return result[0] ? toRecord(result[0]) : null;
  }

  async findByIds(ids: string[]): Promise<UserRecord[]> {
    if (ids.length === 0) return [];
    const rows = await db.select().from(users).where(inArray(users.id, ids));
    return rows.map(toRecord);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return result[0] ? toRecord(result[0]) : null;
  }

  async create(input: {
    email: string;
    name: string;
    isActive?: boolean;
  }): Promise<UserRecord> {
    const id = crypto.randomUUID();
    const isActive = input.isActive ?? true;

    await db.insert(users).values({
      id,
      email: input.email,
      name: input.name,
      isActive,
    });

    return {
      id,
      email: input.email,
      name: input.name,
      isActive,
      timezone: null,
      avatarKey: null,
      lastSeenAt: null,
    };
  }

  async update(
    id: string,
    input: {
      email?: string;
      name?: string;
      isActive?: boolean;
      timezone?: string | null;
      avatarKey?: string | null;
      lastSeenAt?: string | null;
    },
  ): Promise<UserRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const next = {
      email: input.email ?? existing.email,
      name: input.name ?? existing.name,
      isActive: input.isActive ?? existing.isActive,
      timezone:
        input.timezone !== undefined ? input.timezone : existing.timezone,
      avatarKey:
        input.avatarKey !== undefined ? input.avatarKey : existing.avatarKey,
      lastSeenAt:
        input.lastSeenAt !== undefined ? input.lastSeenAt : existing.lastSeenAt,
    };

    await db
      .update(users)
      .set({
        email: next.email,
        name: next.name,
        isActive: next.isActive,
        timezone: next.timezone,
        avatarKey: next.avatarKey,
        lastSeenAt: next.lastSeenAt ? new Date(next.lastSeenAt) : null,
      })
      .where(eq(users.id, id));

    return { id, ...next };
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id));
    return result[0].affectedRows > 0;
  }
}
