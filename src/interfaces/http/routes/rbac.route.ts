import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { ForbiddenError } from "#/application/errors/forbidden";
import {
  type AuthorizationRepository,
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import {
  CreateRoleUseCase,
  CreateUserUseCase,
  DeleteRoleUseCase,
  DeleteUserUseCase,
  GetRolePermissionsUseCase,
  GetRoleUseCase,
  GetRoleUsersUseCase,
  GetUserRolesUseCase,
  GetUserUseCase,
  ListPermissionsUseCase,
  ListRolesUseCase,
  ListUsersUseCase,
  NotFoundError,
  SetRolePermissionsUseCase,
  SetUserRolesUseCase,
  UpdateRoleUseCase,
  UpdateUserUseCase,
} from "#/application/use-cases/rbac";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { createPermissionMiddleware } from "#/interfaces/http/middleware/permissions";
import {
  errorResponseSchema,
  forbidden,
  notFound,
} from "#/interfaces/http/responses";
import {
  createRoleSchema,
  createUserSchema,
  roleIdParamSchema,
  setRolePermissionsSchema,
  setUserRolesSchema,
  updateRoleSchema,
  updateUserSchema,
  userIdParamSchema,
} from "#/interfaces/http/validators/rbac.schema";
import {
  validateJson,
  validateParams,
} from "#/interfaces/http/validators/standard-validator";

export interface RbacRouterDeps {
  jwtSecret: string;
  repositories: {
    userRepository: UserRepository;
    roleRepository: RoleRepository;
    permissionRepository: PermissionRepository;
    userRoleRepository: UserRoleRepository;
    rolePermissionRepository: RolePermissionRepository;
    authorizationRepository: AuthorizationRepository;
  };
}

export const createRbacRouter = (deps: RbacRouterDeps) => {
  const router = new Hono<{ Variables: JwtUserVariables }>();
  const roleTags = ["Roles"];
  const permissionTags = ["Permissions"];
  const userTags = ["Users"];
  const { authorize } = createPermissionMiddleware({
    jwtSecret: deps.jwtSecret,
    authorizationRepository: deps.repositories.authorizationRepository,
  });

  const listRoles = new ListRolesUseCase({
    roleRepository: deps.repositories.roleRepository,
    userRoleRepository: deps.repositories.userRoleRepository,
  });
  const createRole = new CreateRoleUseCase({
    roleRepository: deps.repositories.roleRepository,
  });
  const getRole = new GetRoleUseCase({
    roleRepository: deps.repositories.roleRepository,
  });
  const updateRole = new UpdateRoleUseCase({
    roleRepository: deps.repositories.roleRepository,
  });
  const deleteRole = new DeleteRoleUseCase({
    roleRepository: deps.repositories.roleRepository,
  });
  const getRolePermissions = new GetRolePermissionsUseCase({
    roleRepository: deps.repositories.roleRepository,
    rolePermissionRepository: deps.repositories.rolePermissionRepository,
    permissionRepository: deps.repositories.permissionRepository,
  });
  const setRolePermissions = new SetRolePermissionsUseCase({
    roleRepository: deps.repositories.roleRepository,
    rolePermissionRepository: deps.repositories.rolePermissionRepository,
    permissionRepository: deps.repositories.permissionRepository,
  });

  const listPermissions = new ListPermissionsUseCase({
    permissionRepository: deps.repositories.permissionRepository,
  });

  const listUsers = new ListUsersUseCase({
    userRepository: deps.repositories.userRepository,
  });
  const createUser = new CreateUserUseCase({
    userRepository: deps.repositories.userRepository,
  });
  const getUser = new GetUserUseCase({
    userRepository: deps.repositories.userRepository,
  });
  const updateUser = new UpdateUserUseCase({
    userRepository: deps.repositories.userRepository,
    userRoleRepository: deps.repositories.userRoleRepository,
    roleRepository: deps.repositories.roleRepository,
  });
  const deleteUser = new DeleteUserUseCase({
    userRepository: deps.repositories.userRepository,
    userRoleRepository: deps.repositories.userRoleRepository,
    roleRepository: deps.repositories.roleRepository,
  });
  const setUserRoles = new SetUserRolesUseCase({
    userRepository: deps.repositories.userRepository,
    roleRepository: deps.repositories.roleRepository,
    userRoleRepository: deps.repositories.userRoleRepository,
  });
  const getUserRoles = new GetUserRolesUseCase({
    userRepository: deps.repositories.userRepository,
    userRoleRepository: deps.repositories.userRoleRepository,
    roleRepository: deps.repositories.roleRepository,
  });
  const getRoleUsers = new GetRoleUsersUseCase({
    roleRepository: deps.repositories.roleRepository,
    userRoleRepository: deps.repositories.userRoleRepository,
    userRepository: deps.repositories.userRepository,
  });

  router.get(
    "/roles",
    ...authorize("roles:read"),
    describeRoute({
      description: "List roles",
      tags: roleTags,
      responses: {
        200: {
          description: "Roles",
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
      const roles = await listRoles.execute();
      return c.json(roles);
    },
  );

  router.post(
    "/roles",
    ...authorize("roles:create"),
    validateJson(createRoleSchema),
    describeRoute({
      description: "Create role",
      tags: roleTags,
      responses: {
        201: { description: "Role created" },
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
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
      const payload = c.req.valid("json");
      const role = await createRole.execute(payload);
      return c.json(role, 201);
    },
  );

  router.get(
    "/roles/:id",
    ...authorize("roles:read"),
    validateParams(roleIdParamSchema),
    describeRoute({
      description: "Get role",
      tags: roleTags,
      responses: {
        200: { description: "Role" },
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
      try {
        const role = await getRole.execute({ id: params.id });
        return c.json(role);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.patch(
    "/roles/:id",
    ...authorize("roles:update"),
    validateParams(roleIdParamSchema),
    validateJson(updateRoleSchema),
    describeRoute({
      description: "Update role",
      tags: roleTags,
      responses: {
        200: { description: "Role" },
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        403: {
          description: "Forbidden (e.g. cannot modify system role)",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
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
      const payload = c.req.valid("json");
      try {
        const role = await updateRole.execute({
          id: params.id,
          ...payload,
        });
        return c.json(role);
      } catch (error) {
        if (error instanceof ForbiddenError) {
          return forbidden(c, error.message);
        }
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.delete(
    "/roles/:id",
    ...authorize("roles:delete"),
    validateParams(roleIdParamSchema),
    describeRoute({
      description: "Delete role",
      tags: roleTags,
      responses: {
        204: { description: "Deleted" },
        403: {
          description: "Forbidden (e.g. cannot delete system role)",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
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
      try {
        await deleteRole.execute({ id: params.id });
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof ForbiddenError) {
          return forbidden(c, error.message);
        }
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.get(
    "/roles/:id/permissions",
    ...authorize("roles:read"),
    validateParams(roleIdParamSchema),
    describeRoute({
      description: "Get role permissions",
      tags: roleTags,
      responses: {
        200: { description: "Permissions" },
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
      try {
        const permissions = await getRolePermissions.execute({
          roleId: params.id,
        });
        return c.json(permissions);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.get(
    "/roles/:id/users",
    ...authorize("roles:read"),
    validateParams(roleIdParamSchema),
    describeRoute({
      description: "Get users assigned to role",
      tags: roleTags,
      responses: {
        200: { description: "Users" },
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
      try {
        const users = await getRoleUsers.execute({ roleId: params.id });
        return c.json(users);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.put(
    "/roles/:id/permissions",
    ...authorize("roles:update"),
    validateParams(roleIdParamSchema),
    validateJson(setRolePermissionsSchema),
    describeRoute({
      description: "Set role permissions",
      tags: roleTags,
      responses: {
        200: { description: "Permissions updated" },
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        403: {
          description: "Forbidden (e.g. cannot modify system role)",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
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
      const payload = c.req.valid("json");
      try {
        const permissions = await setRolePermissions.execute({
          roleId: params.id,
          permissionIds: payload.permissionIds,
        });
        return c.json(permissions);
      } catch (error) {
        if (error instanceof ForbiddenError) {
          return forbidden(c, error.message);
        }
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.get(
    "/permissions",
    ...authorize("roles:read"),
    describeRoute({
      description: "List permissions",
      tags: permissionTags,
      responses: {
        200: { description: "Permissions" },
      },
    }),
    async (c) => {
      const permissions = await listPermissions.execute();
      return c.json(permissions);
    },
  );

  router.get(
    "/users",
    ...authorize("users:read"),
    describeRoute({
      description: "List users",
      tags: userTags,
      responses: {
        200: { description: "Users" },
      },
    }),
    async (c) => {
      const users = await listUsers.execute();
      return c.json(users);
    },
  );

  router.post(
    "/users",
    ...authorize("users:create"),
    validateJson(createUserSchema),
    describeRoute({
      description: "Create user",
      tags: userTags,
      responses: {
        201: { description: "User created" },
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const payload = c.req.valid("json");
      const user = await createUser.execute(payload);
      return c.json(user, 201);
    },
  );

  router.get(
    "/users/:id",
    ...authorize("users:read"),
    validateParams(userIdParamSchema),
    describeRoute({
      description: "Get user",
      tags: userTags,
      responses: {
        200: { description: "User" },
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
      try {
        const user = await getUser.execute({ id: params.id });
        return c.json(user);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.get(
    "/users/:id/roles",
    ...authorize("users:read"),
    validateParams(userIdParamSchema),
    describeRoute({
      description: "Get roles assigned to user",
      tags: userTags,
      responses: {
        200: { description: "Roles" },
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
      try {
        const roles = await getUserRoles.execute({ userId: params.id });
        return c.json(roles);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.patch(
    "/users/:id",
    ...authorize("users:update"),
    validateParams(userIdParamSchema),
    validateJson(updateUserSchema),
    describeRoute({
      description: "Update user",
      tags: userTags,
      responses: {
        200: { description: "User" },
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        403: {
          description: "Forbidden (e.g. cannot modify a Super Admin user)",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
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
      const payload = c.req.valid("json");
      try {
        const user = await updateUser.execute({
          id: params.id,
          ...payload,
          callerUserId: c.get("userId"),
        });
        return c.json(user);
      } catch (error) {
        if (error instanceof ForbiddenError) {
          return forbidden(c, error.message);
        }
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.delete(
    "/users/:id",
    ...authorize("users:delete"),
    validateParams(userIdParamSchema),
    describeRoute({
      description: "Delete user",
      tags: userTags,
      responses: {
        204: { description: "Deleted" },
        403: {
          description: "Forbidden (e.g. cannot delete a Super Admin user)",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
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
      try {
        await deleteUser.execute({
          id: params.id,
          callerUserId: c.get("userId"),
        });
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof ForbiddenError) {
          return forbidden(c, error.message);
        }
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  router.put(
    "/users/:id/roles",
    ...authorize("users:update"),
    validateParams(userIdParamSchema),
    validateJson(setUserRolesSchema),
    describeRoute({
      description: "Assign roles to user",
      tags: userTags,
      responses: {
        200: { description: "Roles assigned" },
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
            },
          },
        },
        403: {
          description:
            "Forbidden (e.g. cannot assign or remove Super Admin role)",
          content: {
            "application/json": {
              schema: resolver(errorResponseSchema),
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
      const payload = c.req.valid("json");
      try {
        const roles = await setUserRoles.execute({
          userId: params.id,
          roleIds: payload.roleIds,
        });
        return c.json(roles);
      } catch (error) {
        if (error instanceof ForbiddenError) {
          return forbidden(c, error.message);
        }
        if (error instanceof NotFoundError) {
          return notFound(c, error.message);
        }
        throw error;
      }
    },
  );

  return router;
};
