import { DEMO_AUDIT_REQUEST_ID_PREFIX } from "../constants";
import { type SeedContext, type SeedStageResult } from "../stage-types";

export async function runCleanupDemoAuditEvents(
  ctx: SeedContext,
): Promise<SeedStageResult> {
  const existingCount = await ctx.repos.auditEventRepository.count({
    offset: 0,
    limit: 1,
    requestId: DEMO_AUDIT_REQUEST_ID_PREFIX,
  });

  if (existingCount === 0) {
    return {
      name: "cleanup-demo-audit-events",
      created: 0,
      updated: 0,
      skipped: 1,
    };
  }

  if (ctx.args.dryRun) {
    return {
      name: "cleanup-demo-audit-events",
      created: 0,
      updated: existingCount,
      skipped: 0,
      notes: ["Dry-run mode: audit events were not deleted."],
    };
  }

  const deleted = await ctx.repos.auditEventRepository.deleteByRequestIdPrefix(
    DEMO_AUDIT_REQUEST_ID_PREFIX,
  );

  return {
    name: "cleanup-demo-audit-events",
    created: 0,
    updated: deleted,
    skipped: 0,
  };
}
