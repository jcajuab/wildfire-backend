import { ValidationError } from "#/application/errors/validation";
import {
  type DeviceGroupRepository,
  type DeviceRepository,
} from "#/application/ports/devices";
import { NotFoundError } from "#/application/use-cases/devices/errors";

const normalizeName = (value: string): string => value.trim();

export class ListDeviceGroupsUseCase {
  constructor(
    private readonly deps: { deviceGroupRepository: DeviceGroupRepository },
  ) {}

  async execute() {
    return this.deps.deviceGroupRepository.list();
  }
}

export class CreateDeviceGroupUseCase {
  constructor(
    private readonly deps: { deviceGroupRepository: DeviceGroupRepository },
  ) {}

  async execute(input: { name: string }) {
    const name = normalizeName(input.name);
    if (name.length === 0) throw new ValidationError("Group name is required");
    const existing = await this.deps.deviceGroupRepository.findByName(name);
    if (existing) return existing;
    return this.deps.deviceGroupRepository.create({ name });
  }
}

export class UpdateDeviceGroupUseCase {
  constructor(
    private readonly deps: { deviceGroupRepository: DeviceGroupRepository },
  ) {}

  async execute(input: { id: string; name?: string }) {
    const name =
      input.name === undefined ? undefined : normalizeName(input.name);
    if (name !== undefined && name.length === 0) {
      throw new ValidationError("Group name is required");
    }
    const updated = await this.deps.deviceGroupRepository.update(input.id, {
      name,
    });
    if (!updated) throw new NotFoundError("Device group not found");
    return updated;
  }
}

export class DeleteDeviceGroupUseCase {
  constructor(
    private readonly deps: { deviceGroupRepository: DeviceGroupRepository },
  ) {}

  async execute(input: { id: string }) {
    const deleted = await this.deps.deviceGroupRepository.delete(input.id);
    if (!deleted) throw new NotFoundError("Device group not found");
  }
}

export class SetDeviceGroupsUseCase {
  constructor(
    private readonly deps: {
      deviceRepository: DeviceRepository;
      deviceGroupRepository: DeviceGroupRepository;
    },
  ) {}

  async execute(input: { deviceId: string; groupIds: string[] }) {
    const device = await this.deps.deviceRepository.findById(input.deviceId);
    if (!device) throw new NotFoundError("Device not found");

    if (input.groupIds.length > 0) {
      const groups = await this.deps.deviceGroupRepository.list();
      const existingIds = new Set(groups.map((g) => g.id));
      const unknown = input.groupIds.find((id) => !existingIds.has(id));
      if (unknown) throw new NotFoundError("Device group not found");
    }

    await this.deps.deviceGroupRepository.setDeviceGroups(
      input.deviceId,
      input.groupIds,
    );
  }
}
