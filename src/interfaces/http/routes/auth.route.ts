import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import {
  type Clock,
  type CredentialsRepository,
  type PasswordVerifier,
  type TokenIssuer,
} from "#/application/ports/auth";
import { type ContentStorage } from "#/application/ports/content";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  AuthenticateUserUseCase,
  type ChangeCurrentUserPasswordUseCase,
  InvalidCredentialsError,
  RefreshSessionUseCase,
  type SetCurrentUserAvatarUseCase,
  type UpdateCurrentUserProfileUseCase,
} from "#/application/use-cases/auth";
import { type DeleteCurrentUserUseCase } from "#/application/use-cases/rbac";
import { NotFoundError } from "#/application/use-cases/rbac/errors";
import { createJwtMiddleware } from "#/infrastructure/auth/jwt";
import { logger } from "#/infrastructure/observability/logger";
import {
  type JwtUserVariables,
  requireJwtUser,
} from "#/interfaces/http/middleware/jwt-user";
import {
  errorResponseSchema,
  internalServerError,
  notFound,
  unauthorized,
} from "#/interfaces/http/responses";
import {
  authLoginSchema,
  avatarUploadSchema,
  patchAuthMeSchema,
  postAuthMePasswordSchema,
} from "#/interfaces/http/validators/auth.schema";
import {
  validateForm,
  validateJson,
} from "#/interfaces/http/validators/standard-validator";

const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2MB

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
  updateCurrentUserProfileUseCase: UpdateCurrentUserProfileUseCase;
  changeCurrentUserPasswordUseCase: ChangeCurrentUserPasswordUseCase;
  setCurrentUserAvatarUseCase: SetCurrentUserAvatarUseCase;
  avatarStorage: ContentStorage;
  avatarUrlExpiresInSeconds: number;
}

const authResponseSchema = z.object({
  type: z.literal("bearer"),
  token: z.string(),
  expiresAt: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
    timezone: z.string().nullable().optional(),
    avatarUrl: z.string().url().optional(),
  }),
  permissions: z.array(z.string()),
});

async function enrichUserWithAvatarUrl(
  user: {
    id: string;
    email: string;
    name: string;
    timezone?: string | null;
    avatarKey?: string | null;
  },
  storage: ContentStorage,
  expiresInSeconds: number,
): Promise<{
  id: string;
  email: string;
  name: string;
  timezone?: string | null;
  avatarUrl?: string;
}> {
  const base = {
    id: user.id,
    email: user.email,
    name: user.name,
    timezone: user.timezone ?? null,
  };
  if (!user.avatarKey) return base;
  const avatarUrl = await storage.getPresignedDownloadUrl({
    key: user.avatarKey,
    expiresInSeconds,
  });
  return { ...base, avatarUrl };
}

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

  router.patch(
    "/me",
    jwtMiddleware,
    requireJwtUser,
    validateJson(patchAuthMeSchema),
    describeRoute({
      description: "Update current user profile (e.g. name)",
      tags: authTags,
      responses: {
        200: {
          description: "Profile updated; returns full auth payload",
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
      const userId = c.get("userId");
      const payload = c.req.valid("json");
      try {
        await deps.updateCurrentUserProfileUseCase.execute({
          userId,
          name: payload.name,
          timezone: payload.timezone,
        });
        const result = await refreshSession.execute({ userId });
        const permissions =
          await deps.authorizationRepository.findPermissionsForUser(
            result.user.id,
          );
        const permissionStrings = permissions.map(
          (p) => `${p.resource}:${p.action}`,
        );
        const user = await enrichUserWithAvatarUrl(
          result.user,
          deps.avatarStorage,
          deps.avatarUrlExpiresInSeconds,
        );
        return c.json({ ...result, user, permissions: permissionStrings });
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          return unauthorized(c, error.message);
        }
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

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
        const user = await enrichUserWithAvatarUrl(
          result.user,
          deps.avatarStorage,
          deps.avatarUrlExpiresInSeconds,
        );
        return c.json({ ...result, user, permissions: permissionStrings });
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
        const user = await enrichUserWithAvatarUrl(
          result.user,
          deps.avatarStorage,
          deps.avatarUrlExpiresInSeconds,
        );
        return c.json({ ...result, user, permissions: permissionStrings });
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          return unauthorized(c, error.message);
        }

        throw error;
      }
    },
  );

  router.post(
    "/me/password",
    jwtMiddleware,
    requireJwtUser,
    validateJson(postAuthMePasswordSchema),
    describeRoute({
      description: "Change current user password",
      tags: authTags,
      responses: {
        204: {
          description: "Password updated",
        },
        400: {
          description: "Invalid request (e.g. new password too short)",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        401: {
          description: "Unauthorized or current password incorrect",
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
      const userId = c.get("userId");
      const payload = c.req.valid("json");
      try {
        await deps.changeCurrentUserPasswordUseCase.execute({
          userId,
          currentPassword: payload.currentPassword,
          newPassword: payload.newPassword,
        });
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          return unauthorized(c, error.message);
        }
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.put(
    "/me/avatar",
    jwtMiddleware,
    requireJwtUser,
    bodyLimit({ maxSize: AVATAR_MAX_BYTES }),
    validateForm(avatarUploadSchema),
    describeRoute({
      description: "Upload or replace current user avatar",
      tags: authTags,
      responses: {
        200: {
          description: "Avatar updated; returns full auth payload",
          content: {
            "application/json": {
              schema: resolver(authResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid request (e.g. not an image or too large)",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
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
      const userId = c.get("userId");
      const payload = c.req.valid("form");
      logger.info({ userId }, "avatar upload start");
      try {
        const file = payload.file;
        const buffer = await file.arrayBuffer();
        await deps.setCurrentUserAvatarUseCase.execute({
          userId,
          body: new Uint8Array(buffer),
          contentType: file.type,
          contentLength: file.size,
        });
        logger.info({ userId }, "avatar upload done");
        const result = await refreshSession.execute({ userId });
        const permissions =
          await deps.authorizationRepository.findPermissionsForUser(
            result.user.id,
          );
        const permissionStrings = permissions.map(
          (p) => `${p.resource}:${p.action}`,
        );
        const user = await enrichUserWithAvatarUrl(
          result.user,
          deps.avatarStorage,
          deps.avatarUrlExpiresInSeconds,
        );
        return c.json({ ...result, user, permissions: permissionStrings });
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(
          {
            err,
            userId,
            errorMessage: err.message,
            errorName: err.name,
          },
          "avatar upload failed",
        );
        const message =
          process.env.NODE_ENV === "development"
            ? `Failed to upload profile picture: ${err.message}`
            : "Failed to upload profile picture. Please try again.";
        return internalServerError(c, message);
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
