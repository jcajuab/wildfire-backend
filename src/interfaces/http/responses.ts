import { type Context } from "hono";
import { z } from "zod";

type AppContextVariables = {
  requestId: string;
  jwtPayload: unknown;
  userId: string;
  userEmail: string;
  sessionId: string;
  fileId: string;
  action: string;
  route: string;
  actorId: string;
  actorType: "user" | "display";
  resourceId: string;
  resourceType: string;
  rbacAssignmentCount: string;
  deniedPermission: string;
  denyErrorCode: string;
  denyErrorType: string;
};

type ContextValue<K extends string> = K extends keyof AppContextVariables
  ? AppContextVariables[K]
  : unknown;

export interface ResponseContext
  extends Omit<
    Context<
      { Variables: Record<string, never> },
      string,
      Record<string, never>
    >,
    "set" | "get" | "var"
  > {
  set: <K extends string>(key: K, value: ContextValue<K>) => void;
  get: <K extends string>(key: K) => ContextValue<K>;
  var: Readonly<Record<string, unknown>> &
    Readonly<
      Omit<Partial<AppContextVariables>, "requestId" | "jwtPayload"> & {
        requestId: string;
        jwtPayload: unknown;
      }
    >;
}

export const apiFieldErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
  code: z.string(),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});

export interface ApiFieldError {
  field: string;
  message: string;
  code: string;
}

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export interface ApiMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiLinks {
  self: string;
  first?: string;
  prev?: string;
  next?: string;
  last?: string;
}

export interface ApiResponse<T> {
  data: T;
}

export interface ApiListResponse<T> {
  data: T[];
  meta: ApiMeta;
  links?: ApiLinks;
}

export const toApiResponse = <T>(data: T): ApiResponse<T> => ({
  data,
});

export const apiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
  });

export const apiListResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    meta: z.object({
      total: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      pageSize: z.number().int().positive(),
      totalPages: z.number().int().nonnegative(),
    }),
    links: z
      .object({
        self: z.string(),
        first: z.string(),
        last: z.string(),
        prev: z.string().optional(),
        next: z.string().optional(),
      })
      .partial(),
  });

type UnknownPayload = Record<string, unknown>;

const isObject = (value: unknown): value is UnknownPayload =>
  value != null && typeof value === "object" && !Array.isArray(value);

const isPositiveInt = (value: unknown): value is number => {
  if (typeof value !== "number") {
    return false;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return false;
  }
  return value > 0;
};

const isNonNegativeInt = (value: unknown): value is number => {
  if (typeof value !== "number") {
    return false;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return false;
  }
  return value >= 0;
};

const parsePositiveInt = (value: unknown): number | undefined => {
  if (typeof value === "number" && isPositiveInt(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
};

const parseNonNegativeInt = (value: unknown): number | undefined => {
  if (typeof value === "number" && isNonNegativeInt(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
};

const parseHeaderInt = (value: unknown): number | undefined => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const hasDataEnvelope = (payload: unknown): payload is UnknownPayload =>
  isObject(payload) && Object.hasOwn(payload, "data");

const hasListPayloadWithoutMeta = (payload: UnknownPayload): boolean => {
  if (!Object.hasOwn(payload, "data")) return false;
  if (Object.hasOwn(payload, "meta")) return false;
  return Array.isArray((payload as { data: unknown }).data);
};

const isErrorEnvelope = (payload: unknown): payload is ErrorResponse => {
  if (!isObject(payload)) return false;
  if (!Object.hasOwn(payload, "error")) return false;
  const err = payload.error;
  return (
    isObject(err) && Object.hasOwn(err, "code") && Object.hasOwn(err, "message")
  );
};

export const normalizeApiPayload = (
  payload: unknown,
  _options: { requestUrl: string },
): unknown => {
  if (!isObject(payload)) return payload;
  if (hasListPayloadWithoutMeta(payload)) {
    throw new Error(
      `Invalid list response contract from ${_options.requestUrl}: missing meta envelope.`,
    );
  }
  if (hasDataEnvelope(payload) || isErrorEnvelope(payload)) return payload;
  return { data: payload } as ApiResponse<unknown>;
};

const buildListLinks = (
  reqUrl: URL,
  page: number,
  pageSize: number,
  totalPages: number,
): ApiLinks => {
  const base = new URL(reqUrl);

  const withPage = (value: number) => {
    const next = new URL(base);
    next.searchParams.set("page", String(value));
    next.searchParams.set("pageSize", String(pageSize));
    return `${next.pathname}${next.search ? `?${next.searchParams.toString()}` : ""}`;
  };

  return {
    self: withPage(page),
    first: withPage(1),
    last: withPage(totalPages),
    prev: page > 1 ? withPage(page - 1) : undefined,
    next: page < totalPages ? withPage(page + 1) : undefined,
  };
};

export const toApiListResponse = <T>(input: {
  items: readonly T[];
  total: number;
  page: number;
  pageSize: number;
  requestUrl: string;
}): ApiListResponse<T> => {
  const page = parsePositiveInt(input.page) ?? 1;
  const perPage = parsePositiveInt(input.pageSize) ?? 20;
  const total = parseNonNegativeInt(input.total) ?? 0;
  const totalPages = perPage > 0 ? Math.max(1, Math.ceil(total / perPage)) : 1;

  return {
    data: [...input.items],
    meta: {
      total,
      page,
      pageSize: perPage,
      totalPages,
    },
    links: buildListLinks(new URL(input.requestUrl), page, perPage, totalPages),
  };
};

const buildErrorPayload = (
  c: ResponseContext,
  code: string,
  message: string,
  details?: unknown,
): ErrorResponse => ({
  error: {
    code,
    message,
    requestId: c.get("requestId"),
    ...(details !== undefined ? { details } : {}),
  },
});

export const parseValidationDetails = (
  issues: readonly unknown[] | undefined,
): ApiFieldError[] => {
  if (!Array.isArray(issues) || issues.length === 0) {
    return [];
  }

  return issues.map((issue) => {
    if (!isObject(issue)) {
      return {
        field: "body",
        message: String(issue),
        code: "invalid_value",
      };
    }

    const i = issue as { path?: unknown; message?: string; code?: string };
    const path = Array.isArray(i.path) ? i.path.map(String).join(".") : "body";

    return {
      field: path,
      message: String(i.message ?? "Invalid value"),
      code: String(i.code ?? "invalid_value"),
    };
  });
};

export const badRequest = (c: ResponseContext, message: string) =>
  c.json<ErrorResponse>(buildErrorPayload(c, "invalid_request", message), 400);

export const validationError = (
  c: ResponseContext,
  message: string,
  details: ApiFieldError[] = [],
) =>
  c.json<ErrorResponse>(
    buildErrorPayload(c, "validation_error", message, details),
    422,
  );

export const unprocessable = validationError;

export const notImplemented = (c: ResponseContext, message: string) =>
  c.json<ErrorResponse>(buildErrorPayload(c, "not_implemented", message), 501);

export const unauthorized = (c: ResponseContext, message: string) =>
  c.json<ErrorResponse>(buildErrorPayload(c, "unauthorized", message), 401);

export const forbidden = (c: ResponseContext, message: string) =>
  c.json<ErrorResponse>(buildErrorPayload(c, "forbidden", message), 403);

export const notFound = (c: ResponseContext, message: string) =>
  c.json<ErrorResponse>(buildErrorPayload(c, "not_found", message), 404);

export const conflict = (c: ResponseContext, message: string) =>
  c.json<ErrorResponse>(buildErrorPayload(c, "conflict", message), 409);

export const tooManyRequests = (c: ResponseContext, message: string) =>
  (() => {
    const limit = parseHeaderInt(c.get("rateLimitLimit")) ?? 100;
    const remaining = parseHeaderInt(c.get("rateLimitRemaining")) ?? 0;
    const reset = parseHeaderInt(c.get("rateLimitReset"));
    const retryAfter = parseHeaderInt(c.get("rateLimitRetryAfter")) ?? 60;

    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, remaining)));
    if (reset != null) {
      c.header("X-RateLimit-Reset", String(reset));
    }
    c.header("Retry-After", String(retryAfter));

    return c.json<ErrorResponse>(
      buildErrorPayload(c, "rate_limit_exceeded", message),
      429,
    );
  })();

export const internalServerError = (c: ResponseContext, message: string) =>
  c.json<ErrorResponse>(buildErrorPayload(c, "internal_error", message), 500);
