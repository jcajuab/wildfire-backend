import { type Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";
import {
  challengeResponseSchema,
  challengeTokenParamSchema,
  createChallengeBodySchema,
  displayRuntimeTags,
  errorResponseSchema,
  verifyChallengeBodySchema,
} from "./contracts";
import {
  type DisplayRuntimeRouterDeps,
  type DisplayRuntimeRouterUseCases,
  type DisplayVars,
} from "./deps";
import { createRuntimeRateLimitMiddleware } from "./middleware";

export const registerDisplayRuntimeAuthRoutes = (input: {
  router: Hono<{ Variables: DisplayVars }>;
  deps: DisplayRuntimeRouterDeps;
  useCases: DisplayRuntimeRouterUseCases;
}) => {
  const { router, deps, useCases } = input;

  router.post(
    "/auth/challenges",
    setAction("display.auth.challenge.create", {
      route: "/display-runtime/auth/challenges",
      actorType: "display",
      resourceType: "display",
    }),
    createRuntimeRateLimitMiddleware(deps, {
      keyPrefix: "display-runtime-auth-challenges",
      maxAttempts: deps.rateLimits.authChallengeMaxAttempts,
      message: "Too many authentication challenge requests. Try again later.",
    }),
    validateJson(createChallengeBodySchema),
    describeRoute({
      description: "Create a display runtime authentication challenge",
      tags: displayRuntimeTags,
      responses: {
        201: {
          description: "Challenge token issued",
          content: {
            "application/json": {
              schema: resolver(challengeResponseSchema),
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        404: {
          description: "Display not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        422: {
          description: "Invalid challenge request payload",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        429: {
          description: "Too many challenge requests",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const result =
          await useCases.issueDisplayAuthChallenge.execute(payload);
        return c.json(toApiResponse(result), 201);
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/auth/challenges/:challengeToken/verify",
    setAction("display.auth.challenge.verify", {
      route: "/display-runtime/auth/challenges/:challengeToken/verify",
      actorType: "display",
      resourceType: "display",
    }),
    createRuntimeRateLimitMiddleware(deps, {
      keyPrefix: "display-runtime-auth-verify",
      maxAttempts: deps.rateLimits.authVerifyMaxAttempts,
      message:
        "Too many authentication verification requests. Try again later.",
    }),
    validateParams(challengeTokenParamSchema),
    validateJson(verifyChallengeBodySchema),
    describeRoute({
      description:
        "Verify a display runtime authentication challenge signature",
      tags: displayRuntimeTags,
      responses: {
        204: { description: "Challenge verified" },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        404: {
          description: "Display not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        422: {
          description: "Invalid verification request payload",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        429: {
          description: "Too many verification requests",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        await useCases.verifyDisplayAuthChallenge.execute({
          challengeToken: params.challengeToken,
          slug: payload.slug,
          keyId: payload.keyId,
          signature: payload.signature,
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
