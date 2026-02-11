import { eq, inArray } from "drizzle-orm";
import { type UserRecord, type UserRepository } from "#/application/ports/rbac";
import { db } from "#/infrastructure/db/client";
import { users } from "#/infrastructure/db/schema/rbac.sql";

export class UserDbRepository implements UserRepository {
  async list(): Promise<UserRecord[]> {
    return db.select().from(users);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  async findByIds(ids: string[]): Promise<UserRecord[]> {
    if (ids.length === 0) return [];
    return db.select().from(users).where(inArray(users.id, ids));
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return result[0] ?? null;
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
    };

    await db
      .update(users)
      .set({
        email: next.email,
        name: next.name,
        isActive: next.isActive,
        timezone: next.timezone,
        avatarKey: next.avatarKey,
      })
      .where(eq(users.id, id));

    return { id, ...next };
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id));
    return result[0].affectedRows > 0;
  }
}
