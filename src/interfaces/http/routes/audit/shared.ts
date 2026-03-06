import { type Hono, type MiddlewareHandler } from "hono";
import { type AuditLogRepository } from "#/application/ports/audit";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type DisplayRepository } from "#/application/ports/displays";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  ExportAuditLogsUseCase,
  ListAuditLogsUseCase,
} from "#/application/use-cases/audit";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";

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
}

export interface AuditRouterUseCases {
  listAuditLogs: ListAuditLogsUseCase;
  exportAuditLogs: ExportAuditLogsUseCase;
}

export type AuditRouter = Hono<{ Variables: JwtUserVariables }>;

export type AuthorizePermission = (
  permission: string,
) => readonly [
  MiddlewareHandler,
  MiddlewareHandler<{ Variables: JwtUserVariables }>,
];

export const auditTags = ["Audit"];

export const createAuditUseCases = (
  deps: AuditRouterDeps,
): AuditRouterUseCases => ({
  listAuditLogs: new ListAuditLogsUseCase({
    auditLogRepository: deps.repositories.auditLogRepository,
  }),
  exportAuditLogs: new ExportAuditLogsUseCase({
    auditLogRepository: deps.repositories.auditLogRepository,
    maxRows: deps.exportMaxRows,
  }),
});
