import { type UserRecord } from "#/application/ports/rbac";

export const normalizeQuery = (value: string | undefined): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};

export const filterUsers = (
  users: readonly UserRecord[],
  query: string | undefined,
): UserRecord[] => {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [...users];
  }

  return users.filter((user) => {
    return (
      user.name.toLowerCase().includes(normalized) ||
      user.username.toLowerCase().includes(normalized) ||
      (user.email?.toLowerCase().includes(normalized) ?? false)
    );
  });
};

export const sortUsers = (
  users: readonly UserRecord[],
  input?: { sortBy?: "name" | "lastSeenAt"; sortDirection?: "asc" | "desc" },
): UserRecord[] => {
  const sortBy = input?.sortBy ?? "name";
  const direction = input?.sortDirection === "desc" ? -1 : 1;

  return [...users].sort((left, right) => {
    if (sortBy === "lastSeenAt") {
      if (left.lastSeenAt == null && right.lastSeenAt == null) {
        return left.name.localeCompare(right.name) * direction;
      }
      if (left.lastSeenAt == null) {
        return 1;
      }
      if (right.lastSeenAt == null) {
        return -1;
      }

      const lastSeenDelta =
        input?.sortDirection === "desc"
          ? right.lastSeenAt.localeCompare(left.lastSeenAt)
          : left.lastSeenAt.localeCompare(right.lastSeenAt);
      if (lastSeenDelta !== 0) {
        return lastSeenDelta;
      }
      return left.name.localeCompare(right.name) * direction;
    }

    return left.name.localeCompare(right.name) * direction;
  });
};
