import { ForbiddenError } from "#/application/errors/forbidden";

type DcismCheckInput = { invitedAt?: string | null; isAdmin?: boolean };

/**
 * Returns true if the user is a DCISM-authenticated user (synced from HTSHADOW).
 * DCISM users have no `invitedAt` timestamp AND are not the admin user.
 */
export const isDcismUser = (user: DcismCheckInput): boolean =>
  user.invitedAt == null && user.isAdmin !== true;

/**
 * Throws ForbiddenError if a DCISM user attempts to modify their username.
 * Usernames for DCISM users are controlled by the HTSHADOW file.
 * Other fields (name, email) may be edited freely.
 */
export const assertDcismUserCannotModifyIdentity = (
  user: DcismCheckInput,
  fields: { username?: unknown; email?: unknown },
): void => {
  if (!isDcismUser(user)) return;
  if (fields.username !== undefined) {
    throw new ForbiddenError(
      "DCISM users cannot modify their username. It is managed by the system administrator.",
    );
  }
};

/**
 * Throws ForbiddenError if the user is a DCISM-authenticated user.
 * Used to block entire operations (password change, account deletion) for DCISM users.
 */
export const assertNotDcismUser = (
  user: DcismCheckInput,
  message: string,
): void => {
  if (isDcismUser(user)) {
    throw new ForbiddenError(message);
  }
};
