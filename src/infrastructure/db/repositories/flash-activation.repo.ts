import { and, desc, eq, lte } from "drizzle-orm";
import {
  type FlashActivationRecord,
  type FlashActivationRepository,
} from "#/application/ports/flash-activations";
import { db } from "#/infrastructure/db/client";
import { flashActivations } from "#/infrastructure/db/schema/flash-activation.sql";

const parseTone = (value: string): FlashActivationRecord["tone"] => {
  if (value === "INFO" || value === "WARNING" || value === "CRITICAL") {
    return value;
  }
  throw new Error(`Invalid flash tone: ${value}`);
};

const parseStatus = (value: string): FlashActivationRecord["status"] => {
  if (value === "ACTIVE" || value === "STOPPED" || value === "EXPIRED") {
    return value;
  }
  throw new Error(`Invalid flash status: ${value}`);
};

const toIso = (value: Date | string | null): string | null => {
  if (value == null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
};

const toRecord = (
  row: typeof flashActivations.$inferSelect,
): FlashActivationRecord => ({
  id: row.id,
  contentId: row.contentId,
  targetDisplayId: row.targetDisplayId,
  message: row.message,
  tone: parseTone(row.tone),
  status: parseStatus(row.status),
  startedAt: toIso(row.startedAt) ?? new Date(0).toISOString(),
  endsAt: toIso(row.endsAt) ?? new Date(0).toISOString(),
  stoppedAt: toIso(row.stoppedAt),
  stoppedReason: row.stoppedReason ?? null,
  createdById: row.createdById,
  createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
  updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString(),
  replacementCount: row.replacementCount,
});

export class FlashActivationDbRepository implements FlashActivationRepository {
  private async expireEnded(now: Date): Promise<void> {
    await db
      .update(flashActivations)
      .set({
        status: "EXPIRED",
        stoppedAt: now,
        stoppedReason: "expired",
        updatedAt: now,
      })
      .where(
        and(
          eq(flashActivations.status, "ACTIVE"),
          lte(flashActivations.endsAt, now),
        ),
      );
  }

  async findActive(now: Date): Promise<FlashActivationRecord | null> {
    await this.expireEnded(now);
    const rows = await db
      .select()
      .from(flashActivations)
      .where(eq(flashActivations.status, "ACTIVE"))
      .orderBy(desc(flashActivations.createdAt))
      .limit(1);

    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<FlashActivationRecord | null> {
    const rows = await db
      .select()
      .from(flashActivations)
      .where(eq(flashActivations.id, id))
      .limit(1);

    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async create(input: {
    id: string;
    contentId: string;
    targetDisplayId: string;
    message: string;
    tone: FlashActivationRecord["tone"];
    startedAt: Date;
    endsAt: Date;
    createdById: string;
  }): Promise<FlashActivationRecord> {
    await db.insert(flashActivations).values({
      id: input.id,
      contentId: input.contentId,
      targetDisplayId: input.targetDisplayId,
      message: input.message,
      tone: input.tone,
      status: "ACTIVE",
      startedAt: input.startedAt,
      endsAt: input.endsAt,
      createdById: input.createdById,
      createdAt: input.startedAt,
      updatedAt: input.startedAt,
      replacementCount: 0,
    });

    const created = await this.findById(input.id);
    if (!created) {
      throw new Error("Failed to create flash activation");
    }

    return created;
  }

  async stopById(input: {
    id: string;
    stoppedAt: Date;
    reason: string;
    status?: "STOPPED" | "EXPIRED";
  }): Promise<FlashActivationRecord | null> {
    const existing = await this.findById(input.id);
    if (!existing || existing.status !== "ACTIVE") {
      return existing;
    }

    await db
      .update(flashActivations)
      .set({
        status: input.status ?? "STOPPED",
        stoppedAt: input.stoppedAt,
        stoppedReason: input.reason,
        updatedAt: input.stoppedAt,
      })
      .where(eq(flashActivations.id, input.id));

    return this.findById(input.id);
  }

  async stopActive(input: {
    stoppedAt: Date;
    reason: string;
    status?: "STOPPED" | "EXPIRED";
  }): Promise<FlashActivationRecord | null> {
    const active = await this.findActive(input.stoppedAt);
    if (!active) {
      return null;
    }

    return this.stopById({
      id: active.id,
      stoppedAt: input.stoppedAt,
      reason: input.reason,
      status: input.status,
    });
  }

  async createReplacingActive(input: {
    replacementOfId: string;
    replacementStoppedAt: Date;
    replacementReason: string;
    id: string;
    contentId: string;
    targetDisplayId: string;
    message: string;
    tone: FlashActivationRecord["tone"];
    startedAt: Date;
    endsAt: Date;
    createdById: string;
  }): Promise<{
    stopped: FlashActivationRecord | null;
    created: FlashActivationRecord;
  }> {
    return db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(flashActivations)
        .where(eq(flashActivations.id, input.replacementOfId))
        .limit(1);

      const existing = existingRows[0] ? toRecord(existingRows[0]) : null;

      if (existing && existing.status === "ACTIVE") {
        await tx
          .update(flashActivations)
          .set({
            status: "STOPPED",
            stoppedAt: input.replacementStoppedAt,
            stoppedReason: input.replacementReason,
            updatedAt: input.replacementStoppedAt,
          })
          .where(eq(flashActivations.id, input.replacementOfId));
      }

      const stoppedRows = existing
        ? await tx
            .select()
            .from(flashActivations)
            .where(eq(flashActivations.id, input.replacementOfId))
            .limit(1)
        : [];
      const stoppedRow = stoppedRows[0];

      await tx.insert(flashActivations).values({
        id: input.id,
        contentId: input.contentId,
        targetDisplayId: input.targetDisplayId,
        message: input.message,
        tone: input.tone,
        status: "ACTIVE",
        startedAt: input.startedAt,
        endsAt: input.endsAt,
        createdById: input.createdById,
        createdAt: input.startedAt,
        updatedAt: input.startedAt,
        replacementCount: existing ? existing.replacementCount + 1 : 0,
      });

      const createdRows = await tx
        .select()
        .from(flashActivations)
        .where(eq(flashActivations.id, input.id))
        .limit(1);

      const createdRow = createdRows[0];
      if (!createdRow) {
        throw new Error("Failed to create replacement flash activation");
      }

      return {
        stopped: stoppedRow ? toRecord(stoppedRow) : null,
        created: toRecord(createdRow),
      };
    });
  }
}
