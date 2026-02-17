const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export interface PaginationInput {
  readonly page?: number;
  readonly pageSize?: number;
}

export interface PaginatedResult<T> {
  readonly items: T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Apply in-memory pagination to a full result set.
 * Defaults: page 1, pageSize 50, max 100.
 */
export function paginate<T>(
  all: readonly T[],
  input?: PaginationInput,
): PaginatedResult<T> {
  const page = clamp(Math.trunc(input?.page ?? 1), 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clamp(Math.trunc(input?.pageSize ?? 50), 1, 100);
  const offset = (page - 1) * pageSize;

  return {
    items: all.slice(offset, offset + pageSize),
    total: all.length,
    page,
    pageSize,
  };
}
