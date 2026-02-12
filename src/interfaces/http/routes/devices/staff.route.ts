import { type MiddlewareHandler } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { NotFoundError } from "#/application/use-cases/devices";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import { errorResponseSchema, notFound } from "#/interfaces/http/responses";
import {
  deviceIdParamSchema,
  deviceListResponseSchema,
  deviceSchema,
} from "#/interfaces/http/validators/devices.schema";
import { validateParams } from "#/interfaces/http/validators/standard-validator";
import {
  type DevicesRouter,
  type DevicesRouterUseCases,
  deviceTags,
} from "./shared";

type AuthorizePermission = (
  permission: string,
) => readonly [
  MiddlewareHandler,
  MiddlewareHandler<{ Variables: JwtUserVariables }>,
];

export const registerDeviceStaffRoutes = (args: {
  router: DevicesRouter;
  useCases: DevicesRouterUseCases;
  authorize: AuthorizePermission;
}) => {
  const { router, useCases, authorize } = args;

  router.get(
    "/",
    setAction("devices.device.list", { route: "/devices" }),
    ...authorize("devices:read"),
    describeRoute({
      description: "List devices",
      tags: deviceTags,
      responses: {
        200: {
          description: "Devices list",
          content: {
            "application/json": {
              schema: resolver(deviceListResponseSchema),
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
        403: {
          description: "Forbidden",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const items = await useCases.listDevices.execute();
      return c.json({ items });
    },
  );

  router.get(
    "/:id",
    setAction("devices.device.get", {
      route: "/devices/:id",
      resourceType: "device",
    }),
    ...authorize("devices:read"),
    validateParams(deviceIdParamSchema),
    describeRoute({
      description: "Get device",
      tags: deviceTags,
      responses: {
        200: {
          description: "Device details",
          content: {
            "application/json": {
              schema: resolver(deviceSchema),
            },
          },
        },
        404: {
          description: "Not found",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const params = c.req.valid("param");
      c.set("resourceId", params.id);
      try {
        const result = await useCases.getDevice.execute({ id: params.id });
        return c.json(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );
};
