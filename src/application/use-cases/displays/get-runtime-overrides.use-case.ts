import { type RuntimeControlRepository } from "#/application/ports/runtime-controls";

export class GetRuntimeOverridesUseCase {
  constructor(
    private readonly deps: {
      runtimeControlRepository: RuntimeControlRepository;
    },
  ) {}

  async execute(_input: { now: Date }) {
    const global = await this.deps.runtimeControlRepository.getGlobal();

    return {
      globalEmergency: {
        active: global.globalEmergencyActive,
        startedAt: global.globalEmergencyStartedAt,
      },
    };
  }
}
