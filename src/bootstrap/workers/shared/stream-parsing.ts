export interface StreamEntry {
  id: string;
  payload: string;
}

export const parseStreamEntries = (reply: unknown): StreamEntry[] => {
  if (!Array.isArray(reply)) {
    return [];
  }

  const entries: StreamEntry[] = [];

  for (const rawStream of reply) {
    if (!Array.isArray(rawStream) || rawStream.length < 2) {
      continue;
    }

    const rawEntries = rawStream[1];
    if (!Array.isArray(rawEntries)) {
      continue;
    }

    for (const rawEntry of rawEntries) {
      if (!Array.isArray(rawEntry) || rawEntry.length < 2) {
        continue;
      }

      const entryId = rawEntry[0];
      const fields = rawEntry[1];
      if (typeof entryId !== "string" || !Array.isArray(fields)) {
        continue;
      }

      let payload: string | null = null;
      for (let index = 0; index < fields.length; index += 2) {
        const field = fields[index];
        const value = fields[index + 1];
        if (field === "payload" && typeof value === "string") {
          payload = value;
          break;
        }
      }

      if (payload != null) {
        entries.push({
          id: entryId,
          payload,
        });
      }
    }
  }

  return entries;
};
