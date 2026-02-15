import { describeRoute, resolver } from "hono-openapi";
import { InvalidCredentialsError } from "#/application/use-cases/auth";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema, unauthorized } from "#/interfaces/http/responses";
import { authLoginSchema } from "#/interfaces/http/validators/auth.schema";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import {
  type AuthRouter,
  type AuthRouterDeps,
  type AuthRouterUseCases,
  authResponseSchema,
  authTags,
  buildAuthResponse,
} from "./shared";

export const registerAuthLoginRoute = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  useCases: AuthRouterUseCases;
}) => {
  const { router, deps, useCases } = args;

  router.post(
    "/login",
    setAction("auth.session.login", {
      route: "/auth/login",
      resourceType: "session",
    }),
    validateJson(authLoginSchema),
    describeRoute({
      description: "Authenticate user credentials and issue JWT",
      tags: authTags,
      responses: {
        200: {
          description: "Authenticated",
          content: {
            "application/json": {
              schema: resolver(authResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        401: {
          description: "Invalid credentials",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const payload = c.req.valid("json");
      try {
        const result = await useCases.authenticateUser.execute(payload);
        const body = await buildAuthResponse(deps, result);
        c.set("resourceId", body.user.id);
        return c.json(body);
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          return unauthorized(c, error.message);
        }
        throw error;
      }
    },
  );
};
