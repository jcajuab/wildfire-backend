import { describe, expect, test } from "bun:test";
import {
  CreateBucketCommand,
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

describe("S3ContentStorage (integration)", () => {
  maybeTest("uploads, downloads, and deletes an object", async () => {
    if (!hasMinio) {
      throw new Error(
        "RUN_INTEGRATION=true requires MINIO_ENDPOINT, MINIO_BUCKET, MINIO_ROOT_USER, and MINIO_ROOT_PASSWORD",
      );
    }

    const endpoint = process.env.MINIO_ENDPOINT ?? "localhost";
    const port = Number(process.env.MINIO_PORT ?? "9000");
    const useSsl = process.env.MINIO_USE_SSL === "true";
    const region = process.env.MINIO_REGION ?? "us-east-1";
    const bucket = process.env.MINIO_BUCKET ?? "content";
    const accessKeyId = process.env.MINIO_ROOT_USER ?? "minioadmin";
    const secretAccessKey = process.env.MINIO_ROOT_PASSWORD ?? "minioadmin";
    const endpointUrl = `${useSsl ? "https" : "http"}://${endpoint}:${port}`;

    const adminClient = new S3Client({
      region,
      endpoint: endpointUrl,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
    });

    try {
      await adminClient.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await adminClient.send(new CreateBucketCommand({ Bucket: bucket }));
    }

    const storage = new S3ContentStorage({
      bucket,
      region,
      endpoint: endpointUrl,
      accessKeyId,
      secretAccessKey,
    });

    const key = `content/integration/${crypto.randomUUID()}.txt`;
    const body = new TextEncoder().encode("hello");

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
  });

  maybeTest("checkConnectivity reports ok for configured bucket", async () => {
    if (!hasMinio) {
      throw new Error(
        "RUN_INTEGRATION=true requires MINIO_ENDPOINT, MINIO_BUCKET, MINIO_ROOT_USER, and MINIO_ROOT_PASSWORD",
      );
    }

    const endpoint = process.env.MINIO_ENDPOINT ?? "localhost";
    const port = Number(process.env.MINIO_PORT ?? "9000");
    const useSsl = process.env.MINIO_USE_SSL === "true";
    const region = process.env.MINIO_REGION ?? "us-east-1";
    const bucket = process.env.MINIO_BUCKET ?? "content";
    const accessKeyId = process.env.MINIO_ROOT_USER ?? "minioadmin";
    const secretAccessKey = process.env.MINIO_ROOT_PASSWORD ?? "minioadmin";
    const endpointUrl = `${useSsl ? "https" : "http"}://${endpoint}:${port}`;

    const storage = new S3ContentStorage({
      bucket,
      region,
      endpoint: endpointUrl,
      accessKeyId,
      secretAccessKey,
    });

    const result = await storage.checkConnectivity();
    expect(result.ok).toBe(true);
  });
});
