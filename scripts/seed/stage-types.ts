import {
  type PermissionRecord,
  type PermissionRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type UserRepository,
  type UserRoleRepository,
} from "#/application/ports/rbac";
import { type SeedArgs } from "./args";

export interface SeedContext {
  args: SeedArgs;
  targetEmail?: string;
  htshadowPath: string;
  repos: {
    permissionRepository: PermissionRepository;
    roleRepository: RoleRepository;
    rolePermissionRepository: RolePermissionRepository;
    userRepository: UserRepository;
    userRoleRepository: UserRoleRepository;
  };
  io: {
    hashPassword(password: string, saltRounds: number): Promise<string>;
    writeFile(path: string, data: string): Promise<void>;
  };
}

export interface SeedStageResult {
  name: string;
  created: number;
  updated: number;
  skipped: number;
  notes?: string[];
}

export interface SeedStage {
  name: string;
  execute(ctx: SeedContext): Promise<SeedStageResult>;
}

export const permissionKey = (permission: {
  resource: string;
  action: string;
}): string => `${permission.resource}:${permission.action}`;

export const mapPermissionsByKey = (
  permissions: PermissionRecord[],
): Map<string, PermissionRecord> => {
  const map = new Map<string, PermissionRecord>();
  for (const permission of permissions) {
    map.set(permissionKey(permission), permission);
  }
  return map;
};
