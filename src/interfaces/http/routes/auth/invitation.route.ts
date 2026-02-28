import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { setAction } from "#/interfaces/http/middleware/observability";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import {
  apiListResponseSchema,
  apiResponseSchema,
  errorResponseSchema,
  toApiListResponse,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  invitationIdParamSchema,
  invitationListQuerySchema,
  postAuthAcceptInvitationSchema,
  postAuthCreateInvitationSchema,
} from "#/interfaces/http/validators/auth.schema";
import {
  validateJson,
  validateParams,
  validateQuery,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AuthRouter,
  type AuthRouterDeps,
  type AuthRouterUseCases,
  authTags,
} from "./shared";

const inviteCreatedSchema = z.object({
  id: z.string().uuid(),
  expiresAt: z.string(),
  inviteUrl: z.string().optional(),
});

const inviteStatusSchema = z.enum([
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

const inviteListItemSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  status: inviteStatusSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
});

export const registerAuthInvitationRoutes = (args: {
  router: AuthRouter;
  deps: AuthRouterDeps;
  useCases: AuthRouterUseCases;
}) => {
  const { router, deps, useCases } = args;
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    authorizationRepository: deps.authorizationRepository,
    authSessionRepository: deps.authSessionRepository,
    authSessionCookieName: deps.authSessionCookieName,
    authSessionDualMode: deps.authSessionDualMode,
  });

  router.post(
    "/invitations",
    setAction("auth.invitation.create", {
      route: "/auth/invitations",
      resourceType: "invitation",
    }),
    ...authorize("users:create"),
    validateJson(postAuthCreateInvitationSchema),
    describeRoute({
      description: "Create a user invitation and send acceptance email",
      tags: authTags,
      responses: {
        201: {
          description: "Invitation created",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(inviteCreatedSchema)),
            },
          },
        },
        422: {
          description: "Invalid request",
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
        const result = await useCases.createInvitation.execute({
          email: payload.email,
          name: payload.name,
          invitedByUserId: c.get("userId"),
        });
        c.set("resourceId", result.id);

        return c.json(
          {
            id: result.id,
            expiresAt: result.expiresAt,
            ...(process.env.NODE_ENV === "development"
              ? { inviteUrl: result.inviteUrl }
              : {}),
          },
          201,
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/invitations",
    setAction("auth.invitation.list", {
      route: "/auth/invitations",
      resourceType: "invitation",
    }),
    ...authorize("users:create"),
    validateQuery(invitationListQuerySchema),
    describeRoute({
      description: "List recent invitation records",
      tags: authTags,
      responses: {
        200: {
          description: "Invitation records",
          content: {
            "application/json": {
              schema: resolver(apiListResponseSchema(inviteListItemSchema)),
            },
          },
        },
      },
    }),
    async (c) => {
      const query = c.req.valid("query");
      const invitations = await useCases.listInvitations.execute({
        limit: query.limit,
      });
      const pageSize = query.limit ?? 100;
      return c.json(
        toApiListResponse({
          items: invitations,
          total: invitations.length,
          page: 1,
          pageSize,
          requestUrl: c.req.url,
        }),
      );
    },
  );

  router.post(
    "/invitations/:id/resend",
    setAction("auth.invitation.resend", {
      route: "/auth/invitations/:id/resend",
      resourceType: "invitation",
    }),
    ...authorize("users:create"),
    validateParams(invitationIdParamSchema),
    describeRoute({
      description: "Resend an invitation by creating a new active token",
      tags: authTags,
      responses: {
        201: {
          description: "Invitation resent",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(inviteCreatedSchema)),
            },
          },
        },
        404: {
          description: "Invitation not found",
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
        const result = await useCases.resendInvitation.execute({
          id: params.id,
          invitedByUserId: c.get("userId"),
        });
        c.set("resourceId", result.id);

        return c.json(
          {
            id: result.id,
            expiresAt: result.expiresAt,
            ...(process.env.NODE_ENV === "development"
              ? { inviteUrl: result.inviteUrl }
              : {}),
          },
          201,
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/invitations/accept",
    setAction("auth.invitation.accept", {
      route: "/auth/invitations/accept",
      resourceType: "invitation",
    }),
    validateJson(postAuthAcceptInvitationSchema),
    describeRoute({
      description: "Accept invitation and create user credentials",
      tags: authTags,
      responses: {
        204: { description: "Invitation accepted" },
        422: {
          description: "Invalid or expired invitation",
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
        await useCases.acceptInvitation.execute({
          token: payload.token,
          password: payload.password,
          name: payload.name,
        });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
