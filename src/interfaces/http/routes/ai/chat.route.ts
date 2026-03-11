import { stream } from "hono/streaming";
import { setAction } from "#/interfaces/http/middleware/observability";
import { tooManyRequests } from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { aiChatRequestSchema } from "#/interfaces/http/validators/ai.schema";
import { validateJson } from "#/interfaces/http/validators/standard-validator";
import {
  type AIRouter,
  type AIRouterUseCases,
  type AuthorizePermission,
} from "./shared";

const AI_RATE_LIMIT_WINDOW_SECONDS = 60;
const AI_RATE_LIMIT_MAX_REQUESTS = 20;

// Simple in-memory rate limiter per user (resets when server restarts)
const userRequestCounts = new Map<string, { count: number; resetAt: number }>();

const checkRateLimit = (userId: string): boolean => {
  const nowMs = Date.now();
  const resetAt = nowMs + AI_RATE_LIMIT_WINDOW_SECONDS * 1000;
  const existing = userRequestCounts.get(userId);

  if (!existing || existing.resetAt < nowMs) {
    userRequestCounts.set(userId, { count: 1, resetAt });
    return true;
  }

  if (existing.count >= AI_RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  existing.count += 1;
  return true;
};

export const registerAIChatRoutes = (args: {
  router: AIRouter;
  useCases: AIRouterUseCases;
  authorize: AuthorizePermission;
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

        // Rate limiting
        if (!checkRateLimit(userId)) {
          return tooManyRequests(
            c,
            "Too many AI requests. Please wait before trying again.",
          );
        }

        // Prefer per-request API key from header (redacted in logs by security middleware)
        const apiKey = c.req.header("x-ai-provider-key");

        const chunks = await useCases.aiChat.execute({
          conversationId: body.conversationId,
          messages: body.messages,
          provider: body.provider,
          model: body.model,
          apiKey: apiKey ?? undefined,
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          toolNames: body.toolNames,
          userId,
        });

        c.header("Content-Type", "text/event-stream");
        c.header("Cache-Control", "no-cache");
        c.header("Connection", "keep-alive");

        return stream(c, async (streamCtx) => {
          try {
            for await (const chunk of chunks) {
              const line = `data: ${JSON.stringify(chunk)}\n\n`;
              await streamCtx.write(line);
            }
          } catch (_err) {
            const errorChunk = { type: "error", error: "Stream failed" };
            await streamCtx.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
          }
        });
      },
      ...applicationErrorMappers,
    ),
  );
};
