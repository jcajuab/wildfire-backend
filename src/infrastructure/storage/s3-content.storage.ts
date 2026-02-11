import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type ContentStorage } from "#/application/ports/content";

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`MinIO ${operation} timed out after ${ms}ms`)),
      ms,
    );
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export class S3ContentStorage implements ContentStorage {
  private readonly client: S3Client;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly config: {
      bucket: string;
      region: string;
      endpoint: string;
      accessKeyId: string;
      secretAccessKey: string;
      requestTimeoutMs?: number;
    },
  ) {
    this.requestTimeoutMs = config.requestTimeoutMs ?? 15_000;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  async upload(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
    contentLength: number;
  }): Promise<void> {
    await withTimeout(
      this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          ContentLength: input.contentLength,
        }),
      ),
      this.requestTimeoutMs,
      "upload",
    );
  }

  async delete(key: string): Promise<void> {
    await withTimeout(
      this.client.send(
        new DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      ),
      this.requestTimeoutMs,
      "delete",
    );
  }

  async getPresignedDownloadUrl(input: {
    key: string;
    expiresInSeconds: number;
  }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
    });
    return withTimeout(
      getSignedUrl(this.client, command, {
        expiresIn: input.expiresInSeconds,
      }),
      this.requestTimeoutMs,
      "getPresignedDownloadUrl",
    );
  }

  /** Check if MinIO is reachable (e.g. for startup logging). Does not throw. */
  async checkConnectivity(): Promise<{ ok: boolean; error?: string }> {
    try {
      await withTimeout(
        this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket })),
        this.requestTimeoutMs,
        "HeadBucket",
      );
      return { ok: true };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const message =
        "code" in err
          ? `${err.message} (${(err as { code?: string }).code})`
          : err.message;
      return { ok: false, error: message };
    }
  }
}
