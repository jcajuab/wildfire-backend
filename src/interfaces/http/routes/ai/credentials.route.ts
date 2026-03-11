import { setAction } from "#/interfaces/http/middleware/observability";
import { toApiResponse } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  aiCredentialProviderParamSchema,
  aiStoreCredentialRequestSchema,
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

export const registerAICredentialRoutes = (args: {
  router: AIRouter;
  useCases: AIRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  // POST /ai/credentials - store API key for a provider
  router.post(
    "/credentials",
    setAction("ai.credentials.store", {
      route: "/ai/credentials",
      resourceType: "ai",
    }),
    ...authorize("ai:access"),
    validateJson(aiStoreCredentialRequestSchema),
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        const body = c.req.valid("json");

        const credential = await useCases.storeCredential.execute({
          userId,
          provider: body.provider,
          apiKey: body.apiKey,
        });

        return c.json(
          toApiResponse({
            id: credential.id,
            provider: credential.provider,
            keyHint: credential.keyHint,
            createdAt: credential.createdAt,
            updatedAt: credential.updatedAt,
          }),
          201,
        );
      },
      ...applicationErrorMappers,
    ),
  );

  // GET /ai/credentials - list stored credentials for current user
  router.get(
    "/credentials",
    setAction("ai.credentials.list", {
      route: "/ai/credentials",
      resourceType: "ai",
    }),
    ...authorize("ai:access"),
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        const credentials = await useCases.listCredentials.execute(userId);
        return c.json(
          toApiResponse(
            credentials.map((cred) => ({
              id: cred.id,
              provider: cred.provider,
              keyHint: cred.keyHint,
              createdAt: cred.createdAt,
              updatedAt: cred.updatedAt,
            })),
          ),
        );
      },
      ...applicationErrorMappers,
    ),
  );

  // DELETE /ai/credentials/:provider - delete credential for a provider
  router.delete(
    "/credentials/:provider",
    setAction("ai.credentials.delete", {
      route: "/ai/credentials/:provider",
      resourceType: "ai",
    }),
    ...authorize("ai:access"),
    validateParams(aiCredentialProviderParamSchema),
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        const { provider } = c.req.valid("param");

        await useCases.deleteCredential.execute({ userId, provider });

        return c.json(toApiResponse({ deleted: true }));
      },
      ...applicationErrorMappers,
    ),
  );
};
