import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import {
  type Clock,
  type CredentialsRepository,
  type PasswordVerifier,
  type TokenIssuer,
} from "#/application/ports/auth";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  AuthenticateUserUseCase,
  InvalidCredentialsError,
  RefreshSessionUseCase,
} from "#/application/use-cases/auth";
import { type DeleteCurrentUserUseCase } from "#/application/use-cases/rbac";
import { NotFoundError } from "#/application/use-cases/rbac/errors";
import { createJwtMiddleware } from "#/infrastructure/auth/jwt";
import {
  type JwtUserVariables,
  requireJwtUser,
} from "#/interfaces/http/middleware/jwt-user";
import {
  errorResponseSchema,
  notFound,
  unauthorized,
} from "#/interfaces/http/responses";
import { authLoginSchema } from "#/interfaces/http/validators/auth.schema";
import { validateJson } from "#/interfaces/http/validators/standard-validator";

export interface AuthRouterDeps {
  credentialsRepository: CredentialsRepository;
  passwordVerifier: PasswordVerifier;
  tokenIssuer: TokenIssuer;
  userRepository: UserRepository;
  authorizationRepository: AuthorizationRepository;
  clock: Clock;
  tokenTtlSeconds: number;
  issuer?: string;
  jwtSecret: string;
  deleteCurrentUserUseCase: DeleteCurrentUserUseCase;
}

const authResponseSchema = z.object({
  type: z.literal("bearer"),
  token: z.string(),
  expiresAt: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
  }),
  permissions: z.array(z.string()),
});

export const createAuthRouter = (deps: AuthRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const authTags = ["Auth"];

  const authenticateUser = new AuthenticateUserUseCase({
    credentialsRepository: deps.credentialsRepository,
    passwordVerifier: deps.passwordVerifier,
    tokenIssuer: deps.tokenIssuer,
    userRepository: deps.userRepository,
    clock: deps.clock,
    tokenTtlSeconds: deps.tokenTtlSeconds,
    issuer: deps.issuer,
  });

  const refreshSession = new RefreshSessionUseCase({
    tokenIssuer: deps.tokenIssuer,
    userRepository: deps.userRepository,
    clock: deps.clock,
    tokenTtlSeconds: deps.tokenTtlSeconds,
    issuer: deps.issuer,
  });

  const jwtMiddleware = createJwtMiddleware(deps.jwtSecret);

  router.post(
    "/login",
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
        const result = await authenticateUser.execute(payload);
        const permissions =
          await deps.authorizationRepository.findPermissionsForUser(
            result.user.id,
          );
        const permissionStrings = permissions.map(
          (p) => `${p.resource}:${p.action}`,
        );
        return c.json({ ...result, permissions: permissionStrings });
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          return unauthorized(c, error.message);
        }

        throw error;
      }
    },
  );

  router.get(
    "/me",
    jwtMiddleware,
    requireJwtUser,
    describeRoute({
      description: "Get current user and refresh JWT",
      tags: authTags,
      responses: {
        200: {
          description: "Authenticated user",
          content: {
            "application/json": {
              schema: resolver(authResponseSchema),
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
      },
    }),
    async (c) => {
      try {
        const result = await refreshSession.execute({
          userId: c.get("userId"),
        });
        const permissions =
          await deps.authorizationRepository.findPermissionsForUser(
            result.user.id,
          );
        const permissionStrings = permissions.map(
          (p) => `${p.resource}:${p.action}`,
        );
        return c.json({ ...result, permissions: permissionStrings });
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          return unauthorized(c, error.message);
        }

        throw error;
      }
    },
  );

  router.post(
    "/logout",
    jwtMiddleware,
    requireJwtUser,
    describeRoute({
      description: "Logout current user (no-op)",
      tags: authTags,
      responses: {
        204: {
          description: "Logged out",
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    (c) => c.body(null, 204),
  );

  router.delete(
    "/me",
    jwtMiddleware,
    requireJwtUser,
    describeRoute({
      description: "Delete current user account (self-deletion)",
      tags: authTags,
      responses: {
        204: {
          description: "Account deleted",
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
          description: "User not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      try {
        await deps.deleteCurrentUserUseCase.execute({
          userId: c.get("userId"),
        });
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  return router;
};
