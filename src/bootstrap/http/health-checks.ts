import { checkDbConnectivity } from "#/infrastructure/db/client";
import {
  executeRedisCommand,
  getRedisCommandClient,
} from "#/infrastructure/redis/client";
import { S3ContentStorage } from "#/infrastructure/storage/s3-content.storage";
import {
  type HealthDependencyCheck,
  type HealthDependencyChecks,
} from "#/interfaces/http/routes/health.route";

export interface DefaultHealthDependencyChecksConfig {
  healthCheckTimeoutMs: number;
  redisAuditStreamName: string;
  minio: {
    endpoint: string;
    port: number;
    useSsl: boolean;
    bucket: string;
    region: string;
    rootUser: string;
    rootPassword: string;
    requestTimeoutMs: number;
  };
}

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const createStorageConnectivityCheck = (
  config: DefaultHealthDependencyChecksConfig["minio"],
): HealthDependencyCheck => {
  const healthStorage = new S3ContentStorage({
    bucket: config.bucket,
    region: config.region,
    endpoint: `${config.useSsl ? "https" : "http"}://${config.endpoint}:${config.port}`,
    accessKeyId: config.rootUser,
    secretAccessKey: config.rootPassword,
    requestTimeoutMs: config.requestTimeoutMs,
  });

  return async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const result = await healthStorage.checkConnectivity();
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    } catch (error) {
      return {
        ok: false,
        error: toErrorMessage(error),
      };
    }
  };
};

export const createDefaultHealthDependencyChecks = (
  config: DefaultHealthDependencyChecksConfig,
): HealthDependencyChecks => ({
  checkMySql: async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      await checkDbConnectivity();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: toErrorMessage(error),
      };
    }
  },
  checkRedis: async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const redis = await getRedisCommandClient();
      await executeRedisCommand<void>(redis, ["PING"], {
        timeoutMs: config.healthCheckTimeoutMs,
        operationName: "redis ping",
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: toErrorMessage(error),
      };
    }
  },
  checkAuditStream: async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const redis = await getRedisCommandClient();
      await executeRedisCommand<void>(
        redis,
        ["TYPE", config.redisAuditStreamName],
        {
          timeoutMs: config.healthCheckTimeoutMs,
          operationName: "audit stream health check",
        },
      );
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: toErrorMessage(error),
      };
    }
  },
  checkStorage: createStorageConnectivityCheck(config.minio),
});
