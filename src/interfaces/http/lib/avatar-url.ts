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

export async function addAvatarUrlsToUsers<
  T extends { avatarKey?: string | null },
>(
  users: readonly T[],
  storage: ContentStorage,
  expiresInSeconds: number,
): Promise<Array<Omit<T, "avatarKey"> & { avatarUrl?: string }>> {
  const avatarKeys = Array.from(
    new Set(
      users
        .map((user) => user.avatarKey)
        .filter(
          (key): key is string => typeof key === "string" && key.length > 0,
        ),
    ),
  );

  const avatarUrlByKey = new Map<string, string>();
  await Promise.all(
    avatarKeys.map(async (avatarKey) => {
      try {
        const avatarUrl = await storage.getPresignedDownloadUrl({
          key: avatarKey,
          expiresInSeconds,
        });
        avatarUrlByKey.set(avatarKey, avatarUrl);
      } catch {
        // Best-effort enrichment only.
      }
    }),
  );

  return users.map((user) => {
    const { avatarKey, ...rest } = user;
    if (!avatarKey) {
      return rest as Omit<T, "avatarKey"> & { avatarUrl?: string };
    }

    const avatarUrl = avatarUrlByKey.get(avatarKey);
    return {
      ...rest,
      ...(avatarUrl ? { avatarUrl } : {}),
    } as Omit<T, "avatarKey"> & { avatarUrl?: string };
  });
}
