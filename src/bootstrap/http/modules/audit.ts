import {
  ExportAuditLogsUseCase,
  ListAuditLogsUseCase,
} from "#/application/use-cases/audit";
import { CheckPermissionUseCase } from "#/application/use-cases/rbac";
import {
  type AuditRouterDeps,
  type AuditRouterUseCases,
} from "#/interfaces/http/routes/audit/shared";

export interface AuditHttpModule {
  deps: AuditRouterDeps;
  useCases: AuditRouterUseCases;
}

export const createAuditHttpModule = (
  deps: Omit<AuditRouterDeps, "checkPermissionUseCase">,
): AuditHttpModule => {
  const routerDeps: AuditRouterDeps = {
    ...deps,
    checkPermissionUseCase: new CheckPermissionUseCase({
      authorizationRepository: deps.repositories.authorizationRepository,
    }),
  };

  return {
    deps: routerDeps,
    useCases: {
      listAuditLogs: new ListAuditLogsUseCase({
        auditLogRepository: routerDeps.repositories.auditLogRepository,
      }),
      exportAuditLogs: new ExportAuditLogsUseCase({
        auditLogRepository: routerDeps.repositories.auditLogRepository,
        maxRows: routerDeps.exportMaxRows,
      }),
    },
  };
};
