import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { jsonWithServerCache } from "#/interfaces/http/cache/server-cache";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  toApiListResponse,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  authValidationErrorResponses,
  notFoundResponse,
  validationErrorResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  contentIdParamSchema,
  contentListQuerySchema,
  contentListResponseSchema,
  contentOptionSchema,
  contentOptionsQuerySchema,
  contentSchema,
} from "#/interfaces/http/validators/content.schema";
import {
  validateParams,
  validateQuery,
} from "#/interfaces/http/validators/standard-validator";
import {
  type ContentRouter,
  type ContentRouterUseCases,
  contentTags,
  type RequirePermission,
} from "./shared";

export const registerContentReadRoutes = (args: {
  router: ContentRouter;
  useCases: ContentRouterUseCases;
  requirePermission: RequirePermission;
}) => {
  const { router, useCases, requirePermission } = args;

  router.get(
    "/options",
    setAction("content.content.options", {
      route: "/content/options",
      resourceType: "content",
    }),
    requirePermission("content:read"),
    validateQuery(contentOptionsQuerySchema),
    describeRoute({
      description: "List content options",
      tags: contentTags,
      responses: {
        200: {
          description: "Content options",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(z.array(contentOptionSchema))),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        return jsonWithServerCache(
          c,
          { domains: ["content"], ttl: "reference" },
          async () => {
            const query = c.req.valid("query");
            const result = await useCases.listContentOptions.execute({
              status: query.status,
              type: query.type,
              search: query.q,
            });
            return { data: result };
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/",
    setAction("content.content.list", {
      route: "/content",
      resourceType: "content",
    }),
    requirePermission("content:read"),
    validateQuery(contentListQuerySchema),
    describeRoute({
      description: "List content",
      tags: contentTags,
      responses: {
        200: {
          description: "Content list",
          content: {
            "application/json": {
              schema: resolver(contentListResponseSchema),
            },
          },
        },
        ...authValidationErrorResponses,
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        return jsonWithServerCache(
          c,
          { domains: ["content"], ttl: "default" },
          async () => {
            const query = c.req.valid("query");
            const result = await useCases.listContent.execute(query);
            return toApiListResponse({
              items: result.items,
              total: result.total,
              page: result.page,
              pageSize: result.pageSize,
              requestUrl: c.req.url,
            });
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:id{[0-9a-fA-F-]{36}}",
    setAction("content.content.get", {
      route: "/content/:id",
      resourceType: "content",
    }),
    requirePermission("content:read"),
    validateParams(contentIdParamSchema),
    describeRoute({
      description: "Get content details",
      tags: contentTags,
      responses: {
        200: {
          description: "Content details",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(contentSchema)),
            },
          },
        },
        422: {
          ...validationErrorResponse,
        },
        404: {
          ...notFoundResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        c.set("fileId", params.id);
        return jsonWithServerCache(
          c,
          { domains: ["content"], ttl: "default" },
          async () => {
            const result = await useCases.getContent.execute({
              id: params.id,
            });
            return { data: result };
          },
        );
      },
      ...applicationErrorMappers,
    ),
  );
};
