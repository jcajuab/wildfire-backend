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
  await executeRedisCommand((signal) =>
    redis.withAbortSignal(signal).xAck(streamName, streamGroup, entryId),
  );
  await executeRedisCommand((signal) =>
    redis.withAbortSignal(signal).xDel(streamName, entryId),
  );
};
