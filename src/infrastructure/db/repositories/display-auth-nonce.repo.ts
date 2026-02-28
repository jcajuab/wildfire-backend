import { lte } from "drizzle-orm";
import { type DisplayAuthNonceRepository } from "#/application/ports/display-auth";
import { db } from "#/infrastructure/db/client";
import { displayAuthNonces } from "#/infrastructure/db/schema/display-auth-nonce.sql";

const isDuplicateNonceError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const dbError = error as {
    code?: string;
    message?: string;
    sqlMessage?: string;
  };
  const details = [dbError.message, dbError.sqlMessage]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return (
    dbError.code === "ER_DUP_ENTRY" &&
    details.includes("display_auth_nonces_display_nonce_unique")
  );
};

export class DisplayAuthNonceDbRepository
  implements DisplayAuthNonceRepository
{
  async consumeUnique(input: {
    displayId: string;
    nonce: string;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean> {
    await db
      .delete(displayAuthNonces)
      .where(lte(displayAuthNonces.expiresAt, input.now));

    try {
      await db.insert(displayAuthNonces).values({
        id: crypto.randomUUID(),
        displayId: input.displayId,
        nonce: input.nonce,
        expiresAt: input.expiresAt,
        createdAt: input.now,
      });
      return true;
    } catch (error) {
      if (isDuplicateNonceError(error)) {
        return false;
      }
      throw error;
    }
  }
}
