import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  contentIdParamSchema,
  contentListQuerySchema,
  contentListResponseSchema,
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
        422: {
          ...validationErrorResponse,
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const query = c.req.valid("query");
        const result = await useCases.listContent.execute(query);
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );

  router.get(
    "/:id",
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
              schema: resolver(contentSchema),
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
        const result = await useCases.getContent.execute({ id: params.id });
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );
};
