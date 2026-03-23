import { setAction } from "#/interfaces/http/middleware/observability";
import { tooManyRequests } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { type AuthSecurityStore } from "#/interfaces/http/security/redis-auth-security.store";
import { aiChatRequestSchema } from "#/interfaces/http/validators/ai.schema";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import {
  type AIRouter,
  type AIRouterUseCases,
  type AuthorizePermission,
} from "./shared";

export const registerAIChatRoutes = (args: {
  router: AIRouter;
  useCases: AIRouterUseCases;
  authorize: AuthorizePermission;
  authSecurityStore: AuthSecurityStore;
  rateLimitWindowSeconds: number;
  rateLimitMaxRequests: number;
}) => {
  const { router, useCases, authorize } = args;

  router.post(
    "/chat",
    setAction("ai.chat.started", {
      route: "/ai/chat",
      resourceType: "ai",
    }),
    ...authorize("ai:access"),
    validateJson(aiChatRequestSchema),
    withRouteErrorHandling(
      async (c) => {
        const userId = c.get("userId");
        const body = c.req.valid("json");

        // Redis-backed rate limiting
        const allowed = await args.authSecurityStore.consumeEndpointAttempt({
          key: `ai-chat:${userId}`,
          nowMs: Date.now(),
          windowSeconds: args.rateLimitWindowSeconds,
          maxAttempts: args.rateLimitMaxRequests,
        });
        if (!allowed) {
          return tooManyRequests(
            c,
            "Too many AI requests. Please wait before trying again.",
          );
        }

        // Prefer per-request API key from header (redacted in logs by security middleware)
        const apiKey = c.req.header("x-ai-provider-key");

        const result = await useCases.aiChat.execute({
          conversationId: body.conversationId ?? "",
          messages: body.messages,
          provider: body.provider ?? "openai",
          model: body.model ?? "gpt-4o-mini",
          apiKey: apiKey ?? undefined,
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          userId,
        });

        return result.toUIMessageStreamResponse();
      },
      ...applicationErrorMappers,
    ),
  );
};
