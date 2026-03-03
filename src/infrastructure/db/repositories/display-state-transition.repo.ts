import { eq } from "drizzle-orm";
import {
  type DisplayStateTransitionRecord,
  type DisplayStateTransitionRepository,
} from "#/application/ports/display-auth";
import { db } from "#/infrastructure/db/client";
import { displayStateTransitions } from "#/infrastructure/db/schema/display-state-transition.sql";

const parseRegistrationState = (
  value: string,
): "unpaired" | "registered" | "active" | "unregistered" => {
  if (
    value === "unpaired" ||
    value === "registered" ||
    value === "active" ||
    value === "unregistered"
  ) {
    return value;
  }
  throw new Error(`Unexpected display registration transition state: ${value}`);
};

const toRecord = (
  row: typeof displayStateTransitions.$inferSelect,
): DisplayStateTransitionRecord => ({
  id: row.id,
  displayId: row.displayId,
  fromState: parseRegistrationState(row.fromState),
  toState: parseRegistrationState(row.toState),
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
    fromState: "unpaired" | "registered" | "active" | "unregistered";
    toState: "unpaired" | "registered" | "active" | "unregistered";
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
