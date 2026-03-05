import {
  ROOT_PERMISSION as CANONICAL_ROOT_PERMISSION,
  CANONICAL_STANDARD_RESOURCE_ACTIONS,
} from "../../src/domain/rbac/canonical-permissions";

export const BCRYPT_SALT_ROUNDS = 10;

export const ROOT_ROLE_NAME = "Root";

export const ROOT_PERMISSION = CANONICAL_ROOT_PERMISSION;

export const STANDARD_RESOURCE_ACTIONS: ReadonlyArray<{
  resource: string;
  action: string;
}> = CANONICAL_STANDARD_RESOURCE_ACTIONS;
