import { and, desc, eq, gt, isNull, lte } from "drizzle-orm";
import { type InvitationRepository } from "#/application/ports/auth";
import { db } from "#/infrastructure/db/client";
import { invitations } from "#/infrastructure/db/schema/auth-state.sql";

export class InvitationDbRepository implements InvitationRepository {
  async create(input: {
    id: string;
    hashedToken: string;
    email: string;
    name: string | null;
    invitedByUserId: string;
    expiresAt: Date;
  }): Promise<void> {
    const now = new Date();
    await db.insert(invitations).values({
      id: input.id,
      hashedToken: input.hashedToken,
      email: input.email,
      name: input.name,
      invitedByUserId: input.invitedByUserId,
      expiresAt: input.expiresAt,
      acceptedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async findActiveByHashedToken(
    hashedToken: string,
    now: Date,
  ): Promise<{ id: string; email: string; name: string | null } | null> {
    const rows = await db
      .select({
        id: invitations.id,
        email: invitations.email,
        name: invitations.name,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.hashedToken, hashedToken),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, now),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      name: row.name,
    };
  }

  async findById(input: {
    id: string;
  }): Promise<{ id: string; email: string; name: string | null } | null> {
    const rows = await db
      .select({
        id: invitations.id,
        email: invitations.email,
        name: invitations.name,
      })
      .from(invitations)
      .where(eq(invitations.id, input.id))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      name: row.name,
    };
  }

  async listRecent(input: { limit: number }): Promise<
    {
      id: string;
      email: string;
      name: string | null;
      expiresAt: Date;
      acceptedAt: Date | null;
      revokedAt: Date | null;
      createdAt: Date;
    }[]
  > {
    const rows = await db
      .select({
        id: invitations.id,
        email: invitations.email,
        name: invitations.name,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        revokedAt: invitations.revokedAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .orderBy(desc(invitations.createdAt))
      .limit(input.limit);

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      expiresAt: row.expiresAt,
      acceptedAt: row.acceptedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    }));
  }

  async revokeActiveByEmail(email: string, now: Date): Promise<void> {
    await db
      .update(invitations)
      .set({
        revokedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(invitations.email, email),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, now),
        ),
      );
  }

  async markAccepted(id: string, acceptedAt: Date): Promise<void> {
    await db
      .update(invitations)
      .set({
        acceptedAt,
        updatedAt: acceptedAt,
      })
      .where(eq(invitations.id, id));
  }

  async deleteExpired(now: Date): Promise<void> {
    await db.delete(invitations).where(lte(invitations.expiresAt, now));
  }
}
