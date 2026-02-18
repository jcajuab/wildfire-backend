import { type MiddlewareHandler } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { setAction } from "#/interfaces/http/middleware/observability";
import {
  applicationErrorMappers,
  withRouteErrorHandling,
} from "#/interfaces/http/routes/shared/error-handling";
import {
  forbiddenResponse,
  invalidRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "#/interfaces/http/routes/shared/openapi-responses";
import {
  deviceIdParamSchema,
  deviceListResponseSchema,
  deviceSchema,
  patchDeviceRequestBodySchema,
  patchDeviceSchema,
} from "#/interfaces/http/validators/devices.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";
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
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const page = Number(c.req.query("page")) || undefined;
        const pageSize = Number(c.req.query("pageSize")) || undefined;
        const result = await useCases.listDevices.execute({ page, pageSize });
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
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
          ...notFoundResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        c.set("resourceId", params.id);
        const result = await useCases.getDevice.execute({ id: params.id });
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );

  router.patch(
    "/:id",
    setAction("devices.device.update", {
      route: "/devices/:id",
      resourceType: "device",
    }),
    ...authorize("devices:update"),
    validateParams(deviceIdParamSchema),
    validateJson(patchDeviceSchema),
    describeRoute({
      description: "Update device",
      tags: deviceTags,
      requestBody: {
        content: {
          "application/json": {
            schema: patchDeviceRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Updated device",
          content: {
            "application/json": {
              schema: resolver(deviceSchema),
            },
          },
        },
        400: {
          ...invalidRequestResponse,
        },
        401: {
          ...unauthorizedResponse,
        },
        403: {
          ...forbiddenResponse,
        },
        404: {
          ...notFoundResponse,
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        c.set("resourceId", params.id);
        const result = await useCases.updateDevice.execute({
          id: params.id,
          name: payload.name,
          location: payload.location,
          ipAddress: payload.ipAddress,
          macAddress: payload.macAddress,
          screenWidth: payload.screenWidth,
          screenHeight: payload.screenHeight,
          outputType: payload.outputType,
          orientation: payload.orientation,
        });
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );
};
