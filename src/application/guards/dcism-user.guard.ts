import { ForbiddenError } from "#/application/errors/forbidden";

/**
 * Returns true if the user is a DCISM-authenticated user (synced from HTSHADOW).
 * DCISM users have no `invitedAt` timestamp (null or undefined).
 */
export const isDcismUser = (user: { invitedAt?: string | null }): boolean =>
  user.invitedAt == null;

/**
 * Throws ForbiddenError if a DCISM user attempts to modify identity fields
 * (username or email). These fields are controlled by the HTSHADOW file.
 */
export const assertDcismUserCannotModifyIdentity = (
  user: { invitedAt?: string | null },
  fields: { username?: unknown; email?: unknown },
): void => {
  if (!isDcismUser(user)) return;
  if (fields.username !== undefined || fields.email !== undefined) {
    throw new ForbiddenError(
      "DCISM users cannot modify identity fields. These are managed by the HTSHADOW file.",
    );
  }
};

/**
 * Throws ForbiddenError if the user is a DCISM-authenticated user.
 * Used to block entire operations (password change, account deletion) for DCISM users.
 */
export const assertNotDcismUser = (
  user: { invitedAt?: string | null },
  message: string,
): void => {
  if (isDcismUser(user)) {
    throw new ForbiddenError(message);
  }
};
