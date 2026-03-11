import {
  type AuthorizeSignedDisplayRequestUseCase,
  toSignedRequestBodyHash,
} from "#/application/use-cases/displays";
import { logger } from "#/infrastructure/observability/logger";
import {
  MAX_BODY_HASH_BYTES,
  MAX_DISPLAY_TOKEN_FIELD_BYTES,
  MAX_KEY_ID_BYTES,
  MAX_SIGNED_SIGNATURE_BYTES,
} from "#/interfaces/http/lib/constants";
import { resolveClientIp } from "#/interfaces/http/lib/request-client-ip";
import {
  type ResponseContext,
  tooManyRequests,
  unauthorized,
  validationError,
} from "#/interfaces/http/responses";
import { slugParamSchema } from "./contracts";
import { type DisplayRuntimeRouterDeps } from "./deps";

const isString = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= maxBytes;

export const createRuntimeRateLimitMiddleware = (
  deps: DisplayRuntimeRouterDeps,
  input: {
    keyPrefix: string;
    maxAttempts: number;
    message: string;
  },
) => {
  return async (c: ResponseContext, next: () => Promise<void>) => {
    const nowMs = Date.now();
    const ip = resolveClientIp({
      headers: {
        forwardedFor: c.req.header("x-forwarded-for"),
        realIp: c.req.header("x-real-ip"),
        cfConnectingIp: c.req.header("cf-connecting-ip"),
        xClientIp: c.req.header("x-client-ip"),
        forwarded: c.req.header("forwarded"),
      },
      trustProxyHeaders: deps.trustProxyHeaders,
    });
    const key = `${input.keyPrefix}|${ip}`;
    const stats = await deps.authSecurityStore.consumeEndpointAttemptWithStats({
      key,
      nowMs,
      windowSeconds: deps.rateLimits.windowSeconds,
      maxAttempts: input.maxAttempts,
    });

    c.set("rateLimitLimit", String(stats.limit));
    c.set("rateLimitRemaining", String(stats.remaining));
    c.set("rateLimitReset", String(stats.resetEpochSeconds));
    c.set("rateLimitRetryAfter", String(stats.retryAfterSeconds));

    if (!stats.allowed) {
      logger.warn(
        {
          component: "displays",
          event: "display.rate_limit.exceeded",
          route: c.req.path,
          action: c.get("action"),
          ip,
          rateLimitKey: input.keyPrefix,
          limit: stats.limit,
          retryAfterSeconds: stats.retryAfterSeconds,
        },
        "Display runtime rate limit exceeded",
      );
      return tooManyRequests(c, input.message);
    }

    await next();
  };
};

export const createSignedDisplayRequestMiddleware = (input: {
  authorizeSignedDisplayRequest: AuthorizeSignedDisplayRequestUseCase;
}) => {
  return async (c: ResponseContext, next: () => Promise<void>) => {
    const params = slugParamSchema.safeParse(c.req.param());
    if (!params.success) {
      return validationError(c, "Invalid display slug");
    }

    const slug = params.data.slug;
    const keyId = c.req.header("x-display-key-id") ?? "";
    const timestamp = c.req.header("x-display-timestamp") ?? "";
    const nonce = c.req.header("x-display-nonce") ?? "";
    const signature = c.req.header("x-display-signature") ?? "";
    const bodyHashHeader = c.req.header("x-display-body-sha256") ?? "";
    const slugHeader = c.req.header("x-display-slug") ?? "";

    if (
      !keyId ||
      !timestamp ||
      !nonce ||
      !signature ||
      !bodyHashHeader ||
      !slugHeader
    ) {
      return unauthorized(c, "Missing signed request headers");
    }

    if (
      !isString(keyId, MAX_KEY_ID_BYTES) ||
      !isString(timestamp, MAX_DISPLAY_TOKEN_FIELD_BYTES) ||
      !isString(nonce, MAX_DISPLAY_TOKEN_FIELD_BYTES) ||
      !isString(signature, MAX_SIGNED_SIGNATURE_BYTES) ||
      !isString(bodyHashHeader, MAX_BODY_HASH_BYTES) ||
      !isString(slugHeader, MAX_DISPLAY_TOKEN_FIELD_BYTES)
    ) {
      return unauthorized(c, "Invalid signed request header format");
    }

    if (slugHeader !== slug) {
      return unauthorized(c, "Display slug mismatch");
    }

    const rawBody = ["GET", "HEAD"].includes(c.req.method.toUpperCase())
      ? ""
      : await c.req.text();
    const computedHash = toSignedRequestBodyHash(rawBody);
    if (computedHash !== bodyHashHeader) {
      return unauthorized(c, "Invalid body hash");
    }

    const url = new URL(c.req.url);
    const result = await input.authorizeSignedDisplayRequest.execute({
      method: c.req.method.toUpperCase(),
      pathWithQuery: `${url.pathname}${url.search}`,
      slug,
      keyId,
      timestamp,
      nonce,
      signature,
      bodyHash: computedHash,
    });

    c.set("displayId", result.displayId);
    await next();
  };
};
