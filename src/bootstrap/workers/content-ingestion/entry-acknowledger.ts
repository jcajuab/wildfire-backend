import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

export interface EntryAcknowledger {
  ackAndDeleteEntry(entryId: string): Promise<void>;
}

export const createEntryAcknowledger = (input: {
  streamName: string;
  streamGroup: string;
}): EntryAcknowledger => {
  const ackAndDeleteEntry = async (entryId: string): Promise<void> => {
    const redis = await getRedisCommandClient();
    await executeRedisCommand(redis, [
      "XACK",
      input.streamName,
      input.streamGroup,
      entryId,
    ]);
    await executeRedisCommand(redis, ["XDEL", input.streamName, entryId]);
  };

  return {
    ackAndDeleteEntry,
  };
};
