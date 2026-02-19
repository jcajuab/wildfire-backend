import { type PolicyHistoryRepository } from "#/application/ports/rbac";

export class ListPolicyHistoryUseCase {
  constructor(
    private readonly deps: {
      policyHistoryRepository: PolicyHistoryRepository;
    },
  ) {}

  async execute(input?: {
    page?: number;
    pageSize?: number;
    policyVersion?: number;
    changeType?: "role_permissions" | "user_roles";
    targetId?: string;
    actorId?: string;
    from?: string;
    to?: string;
  }) {
    const page = Math.max(1, input?.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, input?.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.deps.policyHistoryRepository.list({
        offset,
        limit: pageSize,
        policyVersion: input?.policyVersion,
        changeType: input?.changeType,
        targetId: input?.targetId,
        actorId: input?.actorId,
        from: input?.from,
        to: input?.to,
      }),
      this.deps.policyHistoryRepository.count({
        policyVersion: input?.policyVersion,
        changeType: input?.changeType,
        targetId: input?.targetId,
        actorId: input?.actorId,
        from: input?.from,
        to: input?.to,
      }),
    ]);

    return {
      items,
      page,
      pageSize,
      total,
    };
  }
}
