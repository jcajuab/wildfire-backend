import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  aiCancelPendingSchema,
  aiConfirmRequestSchema,
} from "#/interfaces/http/validators/ai.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";
import {
  type AIRouter,
  type AIRouterUseCases,
  type AuthorizePermission,
} from "./shared";

export const registerAIConfirmRoutes = (args: {
  router: AIRouter;
  useCases: AIRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  // POST /ai/confirm - confirm or reject a pending action
  router.post(
    "/confirm",
    setAction("ai.action.confirm", {
      route: "/ai/confirm",
      resourceType: "ai",
    }),
    ...authorize("ai:access"),
    validateJson(aiConfirmRequestSchema),
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        const body = c.req.valid("json");

        const result = await useCases.aiConfirmAction.execute({
          token: body.token,
          conversationId: body.conversationId,
          userId,
          approved: body.approved,
        });

        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );

  // GET /ai/pending-actions - list pending actions for current user
  router.get(
    "/pending-actions",
    setAction("ai.action.list", {
      route: "/ai/pending-actions",
      resourceType: "ai",
    }),
    ...authorize("ai:access"),
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        const actions = await useCases.listPendingActions.execute(userId);
        return c.json(toApiResponse(actions));
      },
      ...applicationErrorMappers,
    ),
  );

  // DELETE /ai/pending-actions/:token - cancel a specific pending action
  router.delete(
    "/pending-actions/:token",
    setAction("ai.action.cancel", {
      route: "/ai/pending-actions/:token",
      resourceType: "ai",
    }),
    ...authorize("ai:access"),
    validateParams(aiCancelPendingSchema),
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        const { token } = c.req.valid("param");

        await useCases.cancelPendingAction.execute({ token, userId });

        return c.json(toApiResponse({ cancelled: true }));
      },
      ...applicationErrorMappers,
    ),
  );
};
