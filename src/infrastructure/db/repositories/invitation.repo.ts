import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { type InvitationRepository } from "#/application/ports/auth";
import { db } from "#/infrastructure/db/client";
import { invitations } from "#/infrastructure/db/schema/auth-state.sql";
import { buildLikeContainsPattern } from "#/infrastructure/db/utils/sql";

type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

const statusWhereClause = (status: InvitationStatus | undefined, now: Date) => {
  if (status === "accepted") return isNotNull(invitations.acceptedAt);
  if (status === "revoked") return isNotNull(invitations.revokedAt);
  if (status === "expired") {
    return and(
      isNull(invitations.acceptedAt),
      isNull(invitations.revokedAt),
      lte(invitations.expiresAt, now),
    );
  }
  if (status === "pending") {
    return and(
      isNull(invitations.acceptedAt),
      isNull(invitations.revokedAt),
      gt(invitations.expiresAt, now),
    );
  }
  return undefined;
};

export class InvitationDbRepository implements InvitationRepository {
  async create(input: {
    id: string;
    hashedToken: string;
    email: string;
    name: string | null;
    invitedByUserId: string;
    expiresAt: Date;
    encryptedToken?: string | null;
    tokenIv?: string | null;
    tokenAuthTag?: string | null;
  }): Promise<void> {
    const now = new Date();
    await db.insert(invitations).values({
      id: input.id,
      hashedToken: input.hashedToken,
      email: input.email,
      name: input.name,
      invitedByUserId: input.invitedByUserId,
      expiresAt: input.expiresAt,
      encryptedToken: input.encryptedToken ?? null,
      tokenIv: input.tokenIv ?? null,
      tokenAuthTag: input.tokenAuthTag ?? null,
      acceptedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async findEncryptedTokenById(
    id: string,
    now: Date,
  ): Promise<{
    encryptedToken: string;
    tokenIv: string;
    tokenAuthTag: string;
  } | null> {
    const rows = await db
      .select({
        encryptedToken: invitations.encryptedToken,
        tokenIv: invitations.tokenIv,
        tokenAuthTag: invitations.tokenAuthTag,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.id, id),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, now),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row || !row.encryptedToken || !row.tokenIv || !row.tokenAuthTag) {
      return null;
    }

    return {
      encryptedToken: row.encryptedToken,
      tokenIv: row.tokenIv,
      tokenAuthTag: row.tokenAuthTag,
    };
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

  async countAll(input?: {
    q?: string;
    status?: InvitationStatus;
    now?: Date;
  }): Promise<number> {
    const normalizedQuery = input?.q?.trim();
    const searchClause = normalizedQuery
      ? or(
          like(invitations.email, buildLikeContainsPattern(normalizedQuery)),
          like(invitations.name, buildLikeContainsPattern(normalizedQuery)),
        )
      : undefined;
    const statusClause = statusWhereClause(
      input?.status,
      input?.now ?? new Date(),
    );
    const whereClause = and(searchClause, statusClause);
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(invitations)
      .where(whereClause);
    return Number(rows[0]?.count ?? 0);
  }

  async listPage(input: {
    page: number;
    pageSize: number;
    q?: string;
    status?: InvitationStatus;
    sortBy?: "createdAt" | "email" | "expiresAt";
    sortDirection?: "asc" | "desc";
    now?: Date;
  }): Promise<
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
    const sortBy = input.sortBy ?? "createdAt";
    const sortDirection = input.sortDirection ?? "desc";
    const sortColumn =
      sortBy === "email"
        ? invitations.email
        : sortBy === "expiresAt"
          ? invitations.expiresAt
          : invitations.createdAt;
    const normalizedQuery = input.q?.trim();
    const searchClause = normalizedQuery
      ? or(
          like(invitations.email, buildLikeContainsPattern(normalizedQuery)),
          like(invitations.name, buildLikeContainsPattern(normalizedQuery)),
        )
      : undefined;
    const statusClause = statusWhereClause(
      input.status,
      input.now ?? new Date(),
    );
    const whereClause = and(searchClause, statusClause);
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
      .where(whereClause)
      .orderBy(
        sortDirection === "asc" ? asc(sortColumn) : desc(sortColumn),
        desc(invitations.createdAt),
      )
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

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

  async deleteById(id: string): Promise<boolean> {
    const result = await db.delete(invitations).where(eq(invitations.id, id));
    return (result[0]?.affectedRows ?? 0) > 0;
  }

  async deleteExpired(now: Date): Promise<void> {
    await db.delete(invitations).where(lte(invitations.expiresAt, now));
  }
}
