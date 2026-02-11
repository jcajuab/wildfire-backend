import { type ContentStorage } from "#/application/ports/content";

/**
 * Returns a copy of the user with `avatarUrl` set (presigned) when `avatarKey` is present,
 * and without `avatarKey` so internal storage keys are not exposed in API responses.
 */
export async function addAvatarUrlToUser<
  T extends { avatarKey?: string | null },
>(
  user: T,
  storage: ContentStorage,
  expiresInSeconds: number,
): Promise<Omit<T, "avatarKey"> & { avatarUrl?: string }> {
  const { avatarKey, ...rest } = user;
  if (!avatarKey) {
    return rest as Omit<T, "avatarKey"> & { avatarUrl?: string };
  }
  const avatarUrl = await storage.getPresignedDownloadUrl({
    key: avatarKey,
    expiresInSeconds,
  });
  return { ...rest, avatarUrl } as Omit<T, "avatarKey"> & {
    avatarUrl?: string;
  };
}
