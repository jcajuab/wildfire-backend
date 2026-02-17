import { type Context } from "hono";
import { ForbiddenError } from "#/application/errors/forbidden";
import { NotFoundError } from "#/application/errors/not-found";
import { ValidationError } from "#/application/errors/validation";
import { badRequest, forbidden, notFound } from "#/interfaces/http/responses";

type RouteHandler = (c: any) => Response | Promise<Response>;
type ErrorMapper = (c: any, error: unknown) => Response | null;

interface ErrorConstructor {
  new (...args: any[]): Error;
}

export const mapErrorToResponse = (
  ErrorType: ErrorConstructor,
  responder: (c: Context, message: string) => Response,
): ErrorMapper => {
  return (c, error) => {
    if (error instanceof ErrorType) {
      return responder(c, error.message);
    }
    return null;
  };
};

export const applicationErrorMappers: readonly ErrorMapper[] = [
  mapErrorToResponse(ValidationError, badRequest),
  mapErrorToResponse(ForbiddenError, forbidden),
  mapErrorToResponse(NotFoundError, notFound),
] as const;

export const withRouteErrorHandling = <T extends RouteHandler>(
  handler: T,
  ...mappers: readonly ErrorMapper[]
): T => {
  return (async (c) => {
    try {
      return await handler(c);
    } catch (error) {
      for (const mapper of mappers) {
        const response = mapper(c, error);
        if (response != null) {
          return response;
        }
      }
      throw error;
    }
  }) as T;
};
