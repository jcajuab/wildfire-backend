import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type ContentStorage } from "#/application/ports/content";
import { logger } from "#/infrastructure/observability/logger";
import { addErrorContext } from "#/infrastructure/observability/logging";
import { withTimeout } from "#/shared/retry";

export class S3ContentStorage implements ContentStorage {
  private readonly client: S3Client;
  private readonly requestTimeoutMs: number;
  private readinessPromise: Promise<void> | null = null;

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
    await this.ensureBucketExists();

    const operation = "s3.upload";
    const start = Date.now();
    try {
      await withTimeout(
        (signal) =>
          this.client.send(
            new PutObjectCommand({
              Bucket: this.config.bucket,
              Key: input.key,
              Body: input.body,
              ContentType: input.contentType,
              ContentLength: input.contentLength,
            }),
            { abortSignal: signal },
          ),
        this.requestTimeoutMs,
        "upload",
      );
      logger.info(
        {
          component: "storage",
          operation,
          bucket: this.config.bucket,
          key: input.key,
          durationMs: Date.now() - start,
          success: true,
        },
        "storage upload completed",
      );
    } catch (error) {
      logger.error(
        addErrorContext(
          {
            component: "storage",
            operation,
            bucket: this.config.bucket,
            key: input.key,
            durationMs: Date.now() - start,
            success: false,
          },
          error,
        ),
        "storage upload failed",
      );
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.ensureBucketExists();

    const operation = "s3.delete";
    const start = Date.now();
    try {
      await withTimeout(
        (signal) =>
          this.client.send(
            new DeleteObjectCommand({
              Bucket: this.config.bucket,
              Key: key,
            }),
            { abortSignal: signal },
          ),
        this.requestTimeoutMs,
        "delete",
      );
      logger.info(
        {
          component: "storage",
          operation,
          bucket: this.config.bucket,
          key,
          durationMs: Date.now() - start,
          success: true,
        },
        "storage delete completed",
      );
    } catch (error) {
      logger.error(
        addErrorContext(
          {
            component: "storage",
            operation,
            bucket: this.config.bucket,
            key,
            durationMs: Date.now() - start,
            success: false,
          },
          error,
        ),
        "storage delete failed",
      );
      throw error;
    }
  }

  async download(key: string): Promise<Uint8Array> {
    await this.ensureBucketExists();

    const operation = "s3.download";
    const start = Date.now();
    const complete = (bytes: Uint8Array): Uint8Array => {
      logger.info(
        {
          component: "storage",
          operation,
          bucket: this.config.bucket,
          key,
          durationMs: Date.now() - start,
          success: true,
        },
        "storage download completed",
      );
      return bytes;
    };
    try {
      const response = await withTimeout(
        (signal) =>
          this.client.send(
            new GetObjectCommand({
              Bucket: this.config.bucket,
              Key: key,
            }),
            { abortSignal: signal },
          ),
        this.requestTimeoutMs,
        "download",
      );

      const body = response.Body;
      if (!body) {
        throw new Error("Missing object body");
      }

      if (body instanceof Uint8Array) {
        return complete(body);
      }

      const transformToByteArray = (
        body as {
          transformToByteArray?: () => Promise<Uint8Array | ArrayBuffer>;
        }
      ).transformToByteArray;
      if (typeof transformToByteArray === "function") {
        const bytes = await transformToByteArray.call(body);
        return complete(
          bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
        );
      }

      if (body instanceof ReadableStream) {
        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value == null) continue;
          if (!(value instanceof Uint8Array)) {
            throw new Error("Unsupported response body chunk type");
          }
          const chunk = value;
          chunks.push(chunk);
          total += chunk.byteLength;
        }
        const output = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          output.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return complete(output);
      }

      const maybeIterable = body as AsyncIterable<unknown>;
      if (typeof maybeIterable[Symbol.asyncIterator] === "function") {
        const chunks: Uint8Array[] = [];
        let total = 0;
        for await (const value of maybeIterable) {
          if (value == null) {
            continue;
          }
          if (value instanceof Uint8Array) {
            chunks.push(value);
            total += value.byteLength;
            continue;
          }
          if (value instanceof ArrayBuffer) {
            const chunk = new Uint8Array(value);
            chunks.push(chunk);
            total += chunk.byteLength;
            continue;
          }

          throw new Error("Unsupported response body chunk type");
        }
        const output = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          output.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return complete(output);
      }

      throw new Error("Unsupported response body type");
    } catch (error) {
      logger.error(
        addErrorContext(
          {
            component: "storage",
            operation,
            bucket: this.config.bucket,
            key,
            durationMs: Date.now() - start,
            success: false,
          },
          error,
        ),
        "storage download failed",
      );
      throw error;
    }
  }

  async getPresignedDownloadUrl(input: {
    key: string;
    expiresInSeconds: number;
    responseContentDisposition?: string;
  }): Promise<string> {
    await this.ensureBucketExists();

    const operation = "s3.presignDownload";
    const start = Date.now();
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ResponseContentDisposition: input.responseContentDisposition,
    });
    try {
      const url = await withTimeout(
        getSignedUrl(this.client, command, {
          expiresIn: input.expiresInSeconds,
        }),
        this.requestTimeoutMs,
        "getPresignedDownloadUrl",
      );
      logger.info(
        {
          component: "storage",
          operation,
          bucket: this.config.bucket,
          key: input.key,
          durationMs: Date.now() - start,
          success: true,
        },
        "storage presign completed",
      );
      return url;
    } catch (error) {
      logger.error(
        addErrorContext(
          {
            component: "storage",
            operation,
            bucket: this.config.bucket,
            key: input.key,
            durationMs: Date.now() - start,
            success: false,
          },
          error,
        ),
        "storage presign failed",
      );
      throw error;
    }
  }

  /** Check if MinIO is reachable (e.g. for startup logging). Does not throw. */
  async checkConnectivity(): Promise<{ ok: boolean; error?: string }> {
    const operation = "s3.checkConnectivity";
    const start = Date.now();
    try {
      await withTimeout(
        (signal) =>
          this.client.send(
            new HeadBucketCommand({ Bucket: this.config.bucket }),
            {
              abortSignal: signal,
            },
          ),
        this.requestTimeoutMs,
        "HeadBucket",
      );
      logger.info(
        {
          component: "storage",
          operation,
          bucket: this.config.bucket,
          durationMs: Date.now() - start,
          success: true,
        },
        "storage connectivity check completed",
      );
      return { ok: true };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const message =
        "code" in err
          ? `${err.message} (${(err as { code?: string }).code})`
          : err.message;
      logger.warn(
        addErrorContext(
          {
            component: "storage",
            operation,
            bucket: this.config.bucket,
            durationMs: Date.now() - start,
            success: false,
          },
          err,
        ),
        "storage connectivity check failed",
      );
      return { ok: false, error: message };
    }
  }

  async ensureBucketExists(): Promise<void> {
    if (this.readinessPromise == null) {
      this.readinessPromise = this.ensureBucketExistsInternal().catch(
        (error) => {
          this.readinessPromise = null;
          throw error;
        },
      );
    }

    return this.readinessPromise;
  }

  private async ensureBucketExistsInternal(): Promise<void> {
    const operation = "s3.ensureBucketExists";
    const start = Date.now();

    try {
      await withTimeout(
        (signal) =>
          this.client.send(
            new HeadBucketCommand({ Bucket: this.config.bucket }),
            {
              abortSignal: signal,
            },
          ),
        this.requestTimeoutMs,
        "HeadBucket",
      );
      logger.info(
        {
          component: "storage",
          operation,
          bucket: this.config.bucket,
          durationMs: Date.now() - start,
          success: true,
          action: "already_present",
        },
        "storage bucket ready",
      );
      return;
    } catch (error) {
      if (!this.isBucketMissing(error)) {
        logger.error(
          addErrorContext(
            {
              component: "storage",
              operation,
              bucket: this.config.bucket,
              durationMs: Date.now() - start,
              success: false,
              action: "check_bucket",
            },
            error,
          ),
          "storage bucket readiness check failed",
        );
        throw error;
      }
    }

    const createStartMs = Date.now();
    try {
      await withTimeout(
        (signal) =>
          this.client.send(
            new CreateBucketCommand({ Bucket: this.config.bucket }),
            { abortSignal: signal },
          ),
        this.requestTimeoutMs,
        "CreateBucket",
      );
      logger.info(
        {
          component: "storage",
          operation,
          bucket: this.config.bucket,
          durationMs: Date.now() - createStartMs,
          success: true,
          action: "created",
        },
        "storage bucket created",
      );
      return;
    } catch (error) {
      if (this.isBucketAlreadyAvailable(error)) {
        logger.info(
          {
            component: "storage",
            operation,
            bucket: this.config.bucket,
            durationMs: Date.now() - createStartMs,
            success: true,
            action: "already_available",
          },
          "storage bucket ready",
        );
        return;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(
        addErrorContext(
          {
            component: "storage",
            operation,
            bucket: this.config.bucket,
            durationMs: Date.now() - createStartMs,
            success: false,
            action: "create_bucket",
          },
          error,
        ),
        "storage bucket creation failed",
      );
      throw err;
    }
  }

  private isBucketMissing(error: unknown): boolean {
    const code = this.extractErrorCode(error);
    const statusCode = this.extractHttpStatus(error);
    return code === "NoSuchBucket" || code === "NotFound" || statusCode === 404;
  }

  private isBucketAlreadyAvailable(error: unknown): boolean {
    const code = this.extractErrorCode(error);
    return code === "BucketAlreadyOwnedByYou" || code === "BucketAlreadyExists";
  }

  private extractErrorCode(error: unknown): string | undefined {
    if (!(error instanceof Error)) {
      return undefined;
    }

    const typed = error as {
      code?: string;
      Code?: string;
      name?: string;
    };

    if (typed.code != null && typed.code.length > 0) {
      return typed.code;
    }
    if (typed.Code != null && typed.Code.length > 0) {
      return typed.Code;
    }
    return typed.name;
  }

  private extractHttpStatus(error: unknown): number | undefined {
    if (!(error instanceof Error)) {
      return undefined;
    }

    const typed = error as {
      $metadata?: {
        httpStatusCode?: number;
      };
      statusCode?: number;
      $response?: {
        statusCode?: number;
      };
    };

    if (typed.$metadata?.httpStatusCode != null) {
      return typed.$metadata.httpStatusCode;
    }
    if (typed.statusCode != null) {
      return typed.statusCode;
    }
    if (typed.$response?.statusCode != null) {
      return typed.$response.statusCode;
    }
    return undefined;
  }
}
