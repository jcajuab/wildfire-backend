import { type MiddlewareHandler } from "hono";
import { AppError } from "#/application/errors/app-error";
import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/errors/not-found";
import { ValidationError } from "#/application/errors/validation";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import {
  forbidden,
  notFound,
  type ResponseContext,
  validationError,
} from "#/interfaces/http/responses";

export type AuthorizePermission = (
  permission: string,
) => readonly [
  MiddlewareHandler,
  MiddlewareHandler<{ Variables: JwtUserVariables }>,
];

type ErrorMapper = (c: ResponseContext, error: unknown) => Response | null;
type ErrorClass<T extends Error = Error> = new (
  message: string,
  options?: ErrorOptions,
) => T;

export const mapErrorToResponse = (
  ErrorType: ErrorClass,
  responder: (c: ResponseContext, message: string) => Response,
): ErrorMapper => {
  return (c, error) => {
    if (error instanceof ErrorType) {
      return responder(c, error.message);
    }
    return null;
  };
};

export const appErrorMapper: ErrorMapper = (c, error) => {
  if (!(error instanceof AppError)) {
    return null;
  }

  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
        requestId: c.get("requestId"),
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    },
    error.httpStatus,
  );
};

export const applicationErrorMappers: readonly ErrorMapper[] = [
  appErrorMapper,
  mapErrorToResponse(ValidationError, validationError),
  mapErrorToResponse(ForbiddenError, forbidden),
  mapErrorToResponse(NotFoundError, notFound),
] as const;

export const withRouteErrorHandling = <TContext extends ResponseContext>(
  handler: (c: TContext) => Response | Promise<Response>,
  ...mappers: readonly ErrorMapper[]
): MiddlewareHandler => {
  return async (c) => {
    try {
      return await handler(c as TContext);
    } catch (error) {
      for (const mapper of mappers) {
        const response = mapper(c as TContext, error);
        if (response != null) {
          return response;
        }
      }
      throw error;
    }
  };
};
