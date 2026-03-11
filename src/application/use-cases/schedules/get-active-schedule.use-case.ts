import { type ScheduleRepository } from "#/application/ports/schedules";
import { selectActiveScheduleByKind } from "#/domain/schedules/schedule";
import { DEFAULT_SCHEDULE_TIMEZONE } from "./shared";

export class GetActiveScheduleForDisplayUseCase {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      scheduleTimeZone?: string;
    },
  ) {}

  async execute(input: { displayId: string; now: Date }) {
    const schedules = await this.deps.scheduleRepository.listByDisplay(
      input.displayId,
    );
    return selectActiveScheduleByKind(
      schedules,
      "PLAYLIST",
      input.now,
      this.deps.scheduleTimeZone ?? DEFAULT_SCHEDULE_TIMEZONE,
    );
  }
}
