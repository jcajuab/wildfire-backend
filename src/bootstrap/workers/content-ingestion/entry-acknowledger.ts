import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";

export const ackAndDeleteEntry = async (
  streamName: string,
  streamGroup: string,
  entryId: string,
): Promise<void> => {
  const redis = await getRedisCommandClient();
  await executeRedisCommand(redis, ["XACK", streamName, streamGroup, entryId]);
  await executeRedisCommand(redis, ["XDEL", streamName, entryId]);
};
