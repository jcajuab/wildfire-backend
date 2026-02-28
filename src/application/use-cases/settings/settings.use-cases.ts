import { ValidationError } from "#/application/errors/validation";
import {
  DISPLAY_RUNTIME_SCROLL_PX_PER_SECOND_KEY,
  type SystemSettingRepository,
} from "#/application/ports/settings";

export interface DisplayRuntimeSettingsView {
  scrollPxPerSecond: number;
}

const DEFAULT_SCROLL_PX_PER_SECOND = 24;
const MIN_SCROLL_PX_PER_SECOND = 1;
const MAX_SCROLL_PX_PER_SECOND = 200;

const parseScrollValue = (raw: string): number => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) {
    throw new ValidationError("Scroll speed must be an integer.");
  }
  if (parsed < MIN_SCROLL_PX_PER_SECOND || parsed > MAX_SCROLL_PX_PER_SECOND) {
    throw new ValidationError(
      `Scroll speed must be between ${MIN_SCROLL_PX_PER_SECOND} and ${MAX_SCROLL_PX_PER_SECOND}.`,
    );
  }
  return parsed;
};

export class GetDisplayRuntimeSettingsUseCase {
  constructor(
    private readonly deps: { systemSettingRepository: SystemSettingRepository },
  ) {}

  async execute(): Promise<DisplayRuntimeSettingsView> {
    const setting = await this.deps.systemSettingRepository.findByKey(
      DISPLAY_RUNTIME_SCROLL_PX_PER_SECOND_KEY,
    );
    if (!setting) {
      return { scrollPxPerSecond: DEFAULT_SCROLL_PX_PER_SECOND };
    }
    return { scrollPxPerSecond: parseScrollValue(setting.value) };
  }
}

export class UpdateDisplayRuntimeSettingsUseCase {
  constructor(
    private readonly deps: { systemSettingRepository: SystemSettingRepository },
  ) {}

  async execute(input: {
    scrollPxPerSecond: number;
  }): Promise<DisplayRuntimeSettingsView> {
    if (!Number.isInteger(input.scrollPxPerSecond)) {
      throw new ValidationError("Scroll speed must be an integer.");
    }
    if (
      input.scrollPxPerSecond < MIN_SCROLL_PX_PER_SECOND ||
      input.scrollPxPerSecond > MAX_SCROLL_PX_PER_SECOND
    ) {
      throw new ValidationError(
        `Scroll speed must be between ${MIN_SCROLL_PX_PER_SECOND} and ${MAX_SCROLL_PX_PER_SECOND}.`,
      );
    }
    const updated = await this.deps.systemSettingRepository.upsert({
      key: DISPLAY_RUNTIME_SCROLL_PX_PER_SECOND_KEY,
      value: String(input.scrollPxPerSecond),
    });
    return { scrollPxPerSecond: parseScrollValue(updated.value) };
  }
}
