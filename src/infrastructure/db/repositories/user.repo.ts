import { eq, inArray } from "drizzle-orm";
import { type UserRecord, type UserRepository } from "#/application/ports/rbac";
import { db } from "#/infrastructure/db/client";
import { users } from "#/infrastructure/db/schema/rbac.sql";
import { toNullableIsoString } from "./utils/date";

const normalizeUsername = (username: string): string =>
  username.trim().toLowerCase();

const mapUserRowToRecord = (row: typeof users.$inferSelect): UserRecord => ({
  id: row.id,
  username: row.username,
  email: row.email,
  name: row.name,
  isActive: row.isActive,
  timezone: row.timezone ?? null,
  avatarKey: row.avatarKey ?? null,
  lastSeenAt: toNullableIsoString(row.lastSeenAt),
  invitedAt: toNullableIsoString(row.invitedAt),
  bannedAt: toNullableIsoString(row.bannedAt),
});

export class UserDbRepository implements UserRepository {
  async list(): Promise<UserRecord[]> {
    const rows = await db.select().from(users);
    return rows.map(mapUserRowToRecord);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return result[0] ? mapUserRowToRecord(result[0]) : null;
  }

  async findByIds(ids: string[]): Promise<UserRecord[]> {
    if (ids.length === 0) return [];
    const rows = await db.select().from(users).where(inArray(users.id, ids));
    return rows.map(mapUserRowToRecord);
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const normalized = normalizeUsername(username);
    const result = await db
      .select()
      .from(users)
      .where(eq(users.username, normalized))
      .limit(1);
    return result[0] ? mapUserRowToRecord(result[0]) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    const result = await db
      .select()
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1);
    return result[0] ? mapUserRowToRecord(result[0]) : null;
  }

  async create(input: {
    username: string;
    email?: string | null;
    name: string;
    isActive?: boolean;
    invitedAt?: Date | null;
  }): Promise<UserRecord> {
    const id = crypto.randomUUID();
    const isActive = input.isActive ?? true;
    const username = normalizeUsername(input.username);
    const email = input.email?.trim().toLowerCase() ?? null;
    const invitedAt = input.invitedAt ?? null;

    await db.insert(users).values({
      id,
      username,
      email,
      name: input.name,
      isActive,
      invitedAt,
    });

    return {
      id,
      username,
      email,
      name: input.name,
      isActive,
      timezone: null,
      avatarKey: null,
      lastSeenAt: null,
      invitedAt: invitedAt?.toISOString() ?? null,
      bannedAt: null,
    };
  }

  async update(
    id: string,
    input: {
      username?: string;
      email?: string | null;
      name?: string;
      isActive?: boolean;
      timezone?: string | null;
      avatarKey?: string | null;
      lastSeenAt?: string | null;
      bannedAt?: Date | null;
    },
  ): Promise<UserRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const next = {
      username:
        input.username !== undefined
          ? normalizeUsername(input.username)
          : existing.username,
      email:
        input.email !== undefined
          ? (input.email?.trim().toLowerCase() ?? null)
          : existing.email,
      name: input.name ?? existing.name,
      isActive: input.isActive ?? existing.isActive,
      timezone:
        input.timezone !== undefined ? input.timezone : existing.timezone,
      avatarKey:
        input.avatarKey !== undefined ? input.avatarKey : existing.avatarKey,
      lastSeenAt:
        input.lastSeenAt !== undefined ? input.lastSeenAt : existing.lastSeenAt,
      bannedAt:
        "bannedAt" in input
          ? (input.bannedAt ?? null)
          : (existing.bannedAt ?? null),
    };

    await db
      .update(users)
      .set({
        username: next.username,
        email: next.email,
        name: next.name,
        isActive: next.isActive,
        timezone: next.timezone,
        avatarKey: next.avatarKey,
        lastSeenAt: next.lastSeenAt ? new Date(next.lastSeenAt) : null,
        bannedAt: next.bannedAt ? new Date(next.bannedAt) : null,
      })
      .where(eq(users.id, id));

    return {
      id,
      username: next.username,
      email: next.email,
      name: next.name,
      isActive: next.isActive,
      timezone: next.timezone,
      avatarKey: next.avatarKey,
      lastSeenAt: next.lastSeenAt,
      invitedAt: existing.invitedAt ?? null,
      bannedAt: next.bannedAt ? new Date(next.bannedAt).toISOString() : null,
    };
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id));
    return (result[0]?.affectedRows ?? 0) > 0;
  }
}
