import { describe, expect, test } from "bun:test";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { S3ContentStorage } from "#/infrastructure/storage/s3-content.storage";

const runIntegration = process.env.RUN_INTEGRATION === "true";
const hasMinio = Boolean(
  process.env.MINIO_ENDPOINT &&
    process.env.MINIO_BUCKET &&
    process.env.MINIO_ROOT_USER &&
    process.env.MINIO_ROOT_PASSWORD,
);
const maybeTest = runIntegration ? test : test.skip;

const getMinioConfig = (bucket: string) => {
  if (!hasMinio) {
    throw new Error(
      "RUN_INTEGRATION=true requires MINIO_ENDPOINT, MINIO_BUCKET, MINIO_ROOT_USER, and MINIO_ROOT_PASSWORD",
    );
  }

  const endpoint = process.env.MINIO_ENDPOINT ?? "localhost";
  const port = Number(process.env.MINIO_PORT ?? "9000");
  const useSsl = process.env.MINIO_USE_SSL === "true";
  const region = process.env.MINIO_REGION ?? "us-east-1";
  const accessKeyId = process.env.MINIO_ROOT_USER ?? "minioadmin";
  const secretAccessKey = process.env.MINIO_ROOT_PASSWORD ?? "minioadmin";
  const endpointUrl = `${useSsl ? "https" : "http"}://${endpoint}:${port}`;

  return {
    endpointUrl,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
  };
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
