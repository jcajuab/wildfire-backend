import { type Hono, type MiddlewareHandler } from "hono";
import { type AuditEventRepository } from "#/application/ports/audit";
import { type AuthSessionRepository } from "#/application/ports/auth";
import { type DisplayRepository } from "#/application/ports/displays";
import {
  type AuthorizationRepository,
  type UserRepository,
} from "#/application/ports/rbac";
import {
  ExportAuditEventsUseCase,
  ListAuditEventsUseCase,
} from "#/application/use-cases/audit";
import { type JwtUserVariables } from "#/interfaces/http/middleware/jwt-user";

export interface AuditRouterDeps {
  jwtSecret: string;
  authSessionRepository?: AuthSessionRepository;
  authSessionCookieName?: string;
  authSessionDualMode?: boolean;
  exportMaxRows: number;
  repositories: {
    auditEventRepository: AuditEventRepository;
    authorizationRepository: AuthorizationRepository;
    userRepository: UserRepository;
    displayRepository: DisplayRepository;
  };
}

export interface AuditRouterUseCases {
  listAuditEvents: ListAuditEventsUseCase;
  exportAuditEvents: ExportAuditEventsUseCase;
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
  listAuditEvents: new ListAuditEventsUseCase({
    auditEventRepository: deps.repositories.auditEventRepository,
  }),
  exportAuditEvents: new ExportAuditEventsUseCase({
    auditEventRepository: deps.repositories.auditEventRepository,
    maxRows: deps.exportMaxRows,
  }),
});
