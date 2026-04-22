export interface StreamEntry {
  id: string;
  payload: string;
}

const getMessageField = (
  message: Map<string, string> | Record<string, string>,
  field: string,
): string | undefined => {
  if (message instanceof Map) {
    return message.get(field);
  }
  return (message as Record<string, string>)[field];
};

export const parseStreamEntries = (reply: unknown): StreamEntry[] => {
  if (!Array.isArray(reply)) return [];

  const entries: StreamEntry[] = [];

  for (const stream of reply) {
    if (!stream || !Array.isArray(stream.messages)) continue;
    for (const msg of stream.messages) {
      if (!msg || typeof msg.id !== "string") continue;
      const message = msg.message as
        | Map<string, string>
        | Record<string, string>;
      const payload = getMessageField(message, "payload");
      if (typeof payload === "string") {
        entries.push({ id: msg.id, payload });
      }
    }
  }

  return entries;
};
