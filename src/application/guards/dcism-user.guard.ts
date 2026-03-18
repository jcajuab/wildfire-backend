import { ForbiddenError } from "#/application/errors/forbidden";

type DcismCheckInput = { invitedAt?: string | null; isAdmin?: boolean };

/**
 * Returns true if the user is a DCISM-authenticated user (synced from HTSHADOW).
 * DCISM users have no `invitedAt` timestamp AND are not the admin user.
 */
export const isDcismUser = (user: DcismCheckInput): boolean =>
  user.invitedAt == null && user.isAdmin !== true;

/**
 * Throws ForbiddenError if a DCISM user attempts to modify identity fields
 * (username or email). These fields are controlled by the HTSHADOW file.
 */
export const assertDcismUserCannotModifyIdentity = (
  user: DcismCheckInput,
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
  user: DcismCheckInput,
  message: string,
): void => {
  if (isDcismUser(user)) {
    throw new ForbiddenError(message);
  }
};
