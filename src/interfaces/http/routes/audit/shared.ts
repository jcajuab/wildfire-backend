import { type Hono } from "hono";
import { type AuditLogRepository } from "#/application/ports/audit";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type DisplayRepository } from "#/application/ports/displays";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  type ExportAuditLogsUseCase,
  type ListAuditLogsUseCase,
} from "#/application/use-cases/audit";
import { type CheckPermissionUseCase } from "#/application/use-cases/rbac";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";
import { type AuthorizePermission } from "#/interfaces/http/routes/shared/error-handling";

export interface AuditRouterDeps {
  jwtSecret: string;
  authSessionRepository: AuthSessionRepository;
  authSessionCookieName: string;
  exportMaxRows: number;
  repositories: {
    auditLogRepository: AuditLogRepository;
    authorizationRepository: AuthorizationRepository;
    userRepository: UserRepository;
    displayRepository: DisplayRepository;
  };
  checkPermissionUseCase: CheckPermissionUseCase;
}

export interface AuditRouterUseCases {
  listAuditLogs: ListAuditLogsUseCase;
  exportAuditLogs: ExportAuditLogsUseCase;
}

export type AuditRouter = Hono<{ Variables: JwtUserVariables }>;

export type { AuthorizePermission };

export const auditTags = ["Audit"];
