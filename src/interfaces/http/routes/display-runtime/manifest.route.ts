import { type Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  apiResponseSchema,
  errorResponseSchema,
  toApiResponse,
} from "#/interfaces/http/responses";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import { displayManifestSchema } from "#/interfaces/http/validators/displays.schema";
import { displayRuntimeTags } from "./contracts";
import { type DisplayRuntimeRouterUseCases, type DisplayVars } from "./deps";
import { createSignedDisplayRequestMiddleware } from "./middleware";

export const registerDisplayRuntimeManifestRoutes = (input: {
  router: Hono<{ Variables: DisplayVars }>;
  useCases: DisplayRuntimeRouterUseCases;
}) => {
  const { router, useCases } = input;

  router.get(
    "/:slug/manifest",
    setAction("display.manifest.read", {
      route: "/display-runtime/:slug/manifest",
      actorType: "display",
      resourceType: "display",
    }),
    createSignedDisplayRequestMiddleware({
      authorizeSignedDisplayRequest: useCases.authorizeSignedDisplayRequest,
    }),
    describeRoute({
      description: "Get signed display manifest payload",
      tags: displayRuntimeTags,
      responses: {
        200: {
          description: "Display manifest",
          content: {
            "application/json": {
              schema: resolver(apiResponseSchema(displayManifestSchema)),
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
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const result = await useCases.getDisplayManifest.execute({
          displayId: String(c.get("displayId")),
          now: new Date(),
        });
        return c.json(toApiResponse(result));
      },
      ...applicationErrorMappers,
    ),
  );
};
