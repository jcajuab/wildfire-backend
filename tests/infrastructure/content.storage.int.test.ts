import { describe, expect, test } from "bun:test";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { S3ContentStorage } from "#/infrastructure/storage/s3-content.storage";
import {
  getIntegrationMinioConfig,
  isRunIntegrationEnabled,
} from "../helpers/integration-env";

const runIntegration = isRunIntegrationEnabled();
const maybeTest = runIntegration ? test : test.skip;

const getMinioConfig = (bucket: string) => {
  return getIntegrationMinioConfig(bucket);
};

const createStorage = (bucket: string) => {
  const config = getMinioConfig(bucket);
  return new S3ContentStorage({
    bucket: config.bucket,
    region: config.region,
    endpoint: config.endpointUrl,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });
};

const createAdminClient = (bucket: string) => {
  const config = getMinioConfig(bucket);
  return new S3Client({
    region: config.region,
    endpoint: config.endpointUrl,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
};

const randomTestBucket = () => `content-${crypto.randomUUID()}`;

const deleteBucket = async (bucket: string): Promise<void> => {
  const adminClient = createAdminClient(bucket);
  try {
    await adminClient.send(new DeleteBucketCommand({ Bucket: bucket }));
  } catch {
    // best-effort cleanup for test environments
  }
};

describe("S3ContentStorage (integration)", () => {
  maybeTest("uploads, downloads, and deletes an object", async () => {
    const bucket = randomTestBucket();
    const storage = createStorage(bucket);
    const adminClient = createAdminClient(bucket);
    const key = `content/integration/${crypto.randomUUID()}.txt`;
    const body = new TextEncoder().encode("hello");

    try {
      try {
        await adminClient.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        await adminClient.send(new CreateBucketCommand({ Bucket: bucket }));
      }

      await storage.ensureBucketExists();
      await storage.upload({
        key,
        body,
        contentType: "text/plain",
        contentLength: body.length,
      });

      const url = await storage.getPresignedDownloadUrl({
        key,
        expiresInSeconds: 60,
      });

      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("hello");

      await storage.delete(key);
    } finally {
      await deleteBucket(bucket);
    }
  });

  maybeTest("checkConnectivity reports ok for configured bucket", async () => {
    const bucket = randomTestBucket();
    const storage = createStorage(bucket);
    const adminClient = createAdminClient(bucket);

    try {
      await adminClient.send(new CreateBucketCommand({ Bucket: bucket }));
      const result = await storage.checkConnectivity();
      expect(result.ok).toBe(true);
    } finally {
      await deleteBucket(bucket);
    }
  });

  maybeTest("ensureBucketExists creates missing bucket", async () => {
    const bucket = randomTestBucket();
    const storage = createStorage(bucket);

    try {
      await storage.ensureBucketExists();
      const result = await storage.checkConnectivity();
      expect(result.ok).toBe(true);
    } finally {
      await deleteBucket(bucket);
    }
  });

  maybeTest(
    "ensureBucketExists is idempotent when bucket already exists",
    async () => {
      const bucket = randomTestBucket();
      const storage = createStorage(bucket);

      try {
        const adminClient = createAdminClient(bucket);
        await adminClient.send(new CreateBucketCommand({ Bucket: bucket }));

        await storage.ensureBucketExists();
        await storage.ensureBucketExists();

        const result = await storage.checkConnectivity();
        expect(result.ok).toBe(true);
      } finally {
        await deleteBucket(bucket);
      }
    },
  );

  maybeTest(
    "checkConnectivity can return false for an unavailable bucket",
    async () => {
      const bucket = randomTestBucket();
      const storage = createStorage(bucket);
      const result = await storage.checkConnectivity();
      expect(result.ok).toBe(false);
    },
  );
});
