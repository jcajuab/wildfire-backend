import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { type InvitationRepository } from "#/application/ports/auth";
import { db } from "#/infrastructure/db/client";
import { invitations } from "#/infrastructure/db/schema/invitation.sql";

export class InvitationDbRepository implements InvitationRepository {
  async create(input: {
    id: string;
    hashedToken: string;
    email: string;
    name: string | null;
    invitedByUserId: string;
    expiresAt: Date;
  }): Promise<void> {
    await db.insert(invitations).values({
      id: input.id,
      hashedToken: input.hashedToken,
      email: input.email,
      name: input.name,
      invitedByUserId: input.invitedByUserId,
      expiresAt: input.expiresAt,
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
          gt(invitations.expiresAt, now),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
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
    return rows[0] ?? null;
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
    return db
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
  }

  async revokeActiveByEmail(email: string, now: Date): Promise<void> {
    await db
      .update(invitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(invitations.email, email),
          gt(invitations.expiresAt, now),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      );
  }

  async markAccepted(id: string, acceptedAt: Date): Promise<void> {
    await db
      .update(invitations)
      .set({ acceptedAt })
      .where(eq(invitations.id, id));
  }

  async deleteExpired(now: Date): Promise<void> {
    await db.delete(invitations).where(lt(invitations.expiresAt, now));
  }
}
