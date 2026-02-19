import { ValidationError } from "#/application/errors/validation";
import {
  DEVICE_RUNTIME_SCROLL_PX_PER_SECOND_KEY,
  type SystemSettingRepository,
} from "#/application/ports/settings";

export interface DeviceRuntimeSettingsView {
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

export class GetDeviceRuntimeSettingsUseCase {
  constructor(
    private readonly deps: { systemSettingRepository: SystemSettingRepository },
  ) {}

  async execute(): Promise<DeviceRuntimeSettingsView> {
    const setting = await this.deps.systemSettingRepository.findByKey(
      DEVICE_RUNTIME_SCROLL_PX_PER_SECOND_KEY,
    );
    if (!setting) {
      return { scrollPxPerSecond: DEFAULT_SCROLL_PX_PER_SECOND };
    }
    return { scrollPxPerSecond: parseScrollValue(setting.value) };
  }
}

export class UpdateDeviceRuntimeSettingsUseCase {
  constructor(
    private readonly deps: { systemSettingRepository: SystemSettingRepository },
  ) {}

  async execute(input: {
    scrollPxPerSecond: number;
  }): Promise<DeviceRuntimeSettingsView> {
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
      key: DEVICE_RUNTIME_SCROLL_PX_PER_SECOND_KEY,
      value: String(input.scrollPxPerSecond),
    });
    return { scrollPxPerSecond: parseScrollValue(updated.value) };
  }
}
