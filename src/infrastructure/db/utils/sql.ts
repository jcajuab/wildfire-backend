export const escapeLikePattern = (value: string): string =>
  value.replace(/[%_\\]/g, (ch) => `\\${ch}`);

export const buildLikeContainsPattern = (value: string): string =>
  `%${escapeLikePattern(value)}%`;
