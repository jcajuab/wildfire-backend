const toPositiveInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;

export const splitPdfDocumentDurationAcrossPages = (input: {
  totalDurationSeconds: number;
  pageCount: number;
}): number[] => {
  const pageCount = toPositiveInteger(input.pageCount, 1);
  const totalDurationSeconds = toPositiveInteger(input.totalDurationSeconds, 1);

  if (totalDurationSeconds < pageCount) {
    return Array.from({ length: pageCount }, () => 1);
  }

  const baseDurationSeconds = Math.floor(totalDurationSeconds / pageCount);
  const remainder = totalDurationSeconds % pageCount;

  return Array.from(
    { length: pageCount },
    (_unused, index) => baseDurationSeconds + (index < remainder ? 1 : 0),
  );
};
