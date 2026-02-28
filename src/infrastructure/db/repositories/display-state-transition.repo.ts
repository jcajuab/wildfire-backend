import { eq } from "drizzle-orm";
import {
  type DisplayStateTransitionRecord,
  type DisplayStateTransitionRepository,
} from "#/application/ports/display-auth";
import { db } from "#/infrastructure/db/client";
import { displayStateTransitions } from "#/infrastructure/db/schema/display-state-transition.sql";

const toRecord = (
  row: typeof displayStateTransitions.$inferSelect,
): DisplayStateTransitionRecord => ({
  id: row.id,
  displayId: row.displayId,
  fromState:
    row.fromState === "unpaired" ||
    row.fromState === "pairing_in_progress" ||
    row.fromState === "registered" ||
    row.fromState === "active" ||
    row.fromState === "unregistered"
      ? row.fromState
      : "unpaired",
  toState:
    row.toState === "unpaired" ||
    row.toState === "pairing_in_progress" ||
    row.toState === "registered" ||
    row.toState === "active" ||
    row.toState === "unregistered"
      ? row.toState
      : "unpaired",
  reason: row.reason,
  actorType:
    row.actorType === "staff" || row.actorType === "display"
      ? row.actorType
      : "system",
  actorId: row.actorId ?? null,
  createdAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
});

export class DisplayStateTransitionDbRepository
  implements DisplayStateTransitionRepository
{
  async create(input: {
    displayId: string;
    fromState:
      | "unpaired"
      | "pairing_in_progress"
      | "registered"
      | "active"
      | "unregistered";
    toState:
      | "unpaired"
      | "pairing_in_progress"
      | "registered"
      | "active"
      | "unregistered";
    reason: string;
    actorType: "staff" | "display" | "system";
    actorId?: string | null;
    createdAt: Date;
  }): Promise<DisplayStateTransitionRecord> {
    const id = crypto.randomUUID();
    await db.insert(displayStateTransitions).values({
      id,
      displayId: input.displayId,
      fromState: input.fromState,
      toState: input.toState,
      reason: input.reason,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      createdAt: input.createdAt,
    });

    const row = await db
      .select()
      .from(displayStateTransitions)
      .where(eq(displayStateTransitions.id, id))
      .limit(1);
    const created = row[0];
    if (!created) {
      throw new Error("Failed to load display state transition");
    }
    return toRecord(created);
  }
}
