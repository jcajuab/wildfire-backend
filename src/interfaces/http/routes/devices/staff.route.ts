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
  createDeviceGroupRequestBodySchema,
  createDeviceGroupSchema,
  deviceGroupIdParamSchema,
  deviceGroupListResponseSchema,
  deviceGroupSchema,
  deviceIdParamSchema,
  deviceListResponseSchema,
  deviceSchema,
  patchDeviceRequestBodySchema,
  patchDeviceSchema,
  setDeviceGroupsRequestBodySchema,
  setDeviceGroupsSchema,
  updateDeviceGroupRequestBodySchema,
  updateDeviceGroupSchema,
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
    "/:id{[0-9a-fA-F-]{36}}",
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
    "/:id{[0-9a-fA-F-]{36}}",
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

  router.get(
    "/groups",
    setAction("devices.group.list", {
      route: "/devices/groups",
      resourceType: "device-group",
    }),
    ...authorize("devices:read"),
    describeRoute({
      description: "List device groups",
      tags: deviceTags,
      responses: {
        200: {
          description: "Device groups",
          content: {
            "application/json": {
              schema: resolver(deviceGroupListResponseSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const items = await useCases.listDeviceGroups.execute();
        return c.json({ items });
      },
      ...applicationErrorMappers,
    ),
  );

  router.post(
    "/groups",
    setAction("devices.group.create", {
      route: "/devices/groups",
      resourceType: "device-group",
    }),
    ...authorize("devices:update"),
    validateJson(createDeviceGroupSchema),
    describeRoute({
      description: "Create device group",
      tags: deviceTags,
      requestBody: {
        content: {
          "application/json": {
            schema: createDeviceGroupRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Device group",
          content: {
            "application/json": {
              schema: resolver(deviceGroupSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const payload = c.req.valid("json");
        const result = await useCases.createDeviceGroup.execute({
          name: payload.name,
        });
        c.set("resourceId", result.id);
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );

  router.patch(
    "/groups/:groupId",
    setAction("devices.group.update", {
      route: "/devices/groups/:groupId",
      resourceType: "device-group",
    }),
    ...authorize("devices:update"),
    validateParams(deviceGroupIdParamSchema),
    validateJson(updateDeviceGroupSchema),
    describeRoute({
      description: "Update device group",
      tags: deviceTags,
      requestBody: {
        content: {
          "application/json": {
            schema: updateDeviceGroupRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        200: {
          description: "Device group",
          content: {
            "application/json": {
              schema: resolver(deviceGroupSchema),
            },
          },
        },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        const result = await useCases.updateDeviceGroup.execute({
          id: params.groupId,
          name: payload.name,
        });
        c.set("resourceId", result.id);
        return c.json(result);
      },
      ...applicationErrorMappers,
    ),
  );

  router.delete(
    "/groups/:groupId",
    setAction("devices.group.delete", {
      route: "/devices/groups/:groupId",
      resourceType: "device-group",
    }),
    ...authorize("devices:update"),
    validateParams(deviceGroupIdParamSchema),
    describeRoute({
      description: "Delete device group",
      tags: deviceTags,
      responses: {
        204: { description: "Deleted" },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        await useCases.deleteDeviceGroup.execute({ id: params.groupId });
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );

  router.put(
    "/:id{[0-9a-fA-F-]{36}}/groups",
    setAction("devices.group.set", {
      route: "/devices/:id/groups",
      resourceType: "device",
    }),
    ...authorize("devices:update"),
    validateParams(deviceIdParamSchema),
    validateJson(setDeviceGroupsSchema),
    describeRoute({
      description: "Set device groups for a device",
      tags: deviceTags,
      requestBody: {
        content: {
          "application/json": {
            schema: setDeviceGroupsRequestBodySchema,
          },
        },
        required: true,
      },
      responses: {
        204: { description: "Updated" },
      },
    }),
    withRouteErrorHandling(
      async (c) => {
        const params = c.req.valid("param");
        const payload = c.req.valid("json");
        await useCases.setDeviceGroups.execute({
          deviceId: params.id,
          groupIds: payload.groupIds,
        });
        c.set("resourceId", params.id);
        return c.body(null, 204);
      },
      ...applicationErrorMappers,
    ),
  );
};
