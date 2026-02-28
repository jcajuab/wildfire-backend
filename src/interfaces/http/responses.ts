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
  rbacPolicyVersion: string;
  rbacTargetCount: string;
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
    details: z.array(apiFieldErrorSchema).optional(),
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
  per_page: number;
  total_pages: number;
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
      per_page: z.number().int().positive(),
      total_pages: z.number().int().nonnegative(),
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

const hasDataEnvelope = (payload: unknown): payload is UnknownPayload => {
  return isObject(payload) && Object.hasOwn(payload, "data");
};

const isErrorEnvelope = (payload: unknown): payload is ErrorResponse => {
  if (!isObject(payload)) {
    return false;
  }
  if (!Object.hasOwn(payload, "error")) {
    return false;
  }
  const err = payload.error;
  return (
    isObject(err) && Object.hasOwn(err, "code") && Object.hasOwn(err, "message")
  );
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
    next.searchParams.set("per_page", String(pageSize));
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
      per_page: perPage,
      total_pages: totalPages,
    },
    links: buildListLinks(new URL(input.requestUrl), page, perPage, totalPages),
  };
};

export const normalizeApiPayload = (
  payload: unknown,
  _options: {
    requestUrl: string;
  },
): unknown => {
  if (!isObject(payload)) {
    return payload;
  }

  const objectPayload = payload as UnknownPayload;

  if (
    hasDataEnvelope(payload) ||
    isErrorEnvelope(payload) ||
    "error" in objectPayload
  ) {
    return payload;
  }

  return {
    data: payload,
  } as ApiResponse<unknown>;
};

const buildErrorPayload = (
  code: string,
  message: string,
  details: ApiFieldError[] = [],
): ErrorResponse => ({
  error: {
    code,
    message,
    ...(details.length > 0 ? { details } : {}),
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
  c.json<ErrorResponse>(buildErrorPayload("INVALID_REQUEST", message), 400);

export const validationError = (
  c: ResponseContext,
  message: string,
  details: ApiFieldError[] = [],
) =>
  c.json<ErrorResponse>(
    buildErrorPayload("VALIDATION_ERROR", message, details),
    422,
  );

export const unprocessable = validationError;

export const notImplemented = (c: ResponseContext, message: string) =>
  c.json<ErrorResponse>(buildErrorPayload("NOT_IMPLEMENTED", message), 501);

export const unauthorized = (c: ResponseContext, message: string) =>
  c.json<ErrorResponse>(buildErrorPayload("UNAUTHORIZED", message), 401);

export const forbidden = (c: ResponseContext, message: string) =>
  c.json<ErrorResponse>(buildErrorPayload("FORBIDDEN", message), 403);

export const notFound = (c: ResponseContext, message: string) =>
  c.json<ErrorResponse>(buildErrorPayload("NOT_FOUND", message), 404);

export const conflict = (c: ResponseContext, message: string) =>
  c.json<ErrorResponse>(buildErrorPayload("CONFLICT", message), 409);

export const internalServerError = (c: ResponseContext, message: string) =>
  c.json<ErrorResponse>(buildErrorPayload("INTERNAL_ERROR", message), 500);
