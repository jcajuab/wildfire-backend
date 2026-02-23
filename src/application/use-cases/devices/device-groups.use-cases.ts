import { ValidationError } from "#/application/errors/validation";
import {
  type DeviceGroupRepository,
  type DeviceRepository,
} from "#/application/ports/devices";
import {
  DeviceGroupConflictError,
  NotFoundError,
} from "#/application/use-cases/devices/errors";

const collapseWhitespace = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const normalizeName = (value: string): string =>
  collapseWhitespace(value).toLowerCase();

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
    const displayName = collapseWhitespace(input.name);
    if (displayName.length === 0) {
      throw new ValidationError("Group name is required");
    }
    const normalizedInputName = normalizeName(displayName);
    const existingGroups = await this.deps.deviceGroupRepository.list();
    const existing = existingGroups.find(
      (group) => normalizeName(group.name) === normalizedInputName,
    );
    if (existing) return existing;
    return this.deps.deviceGroupRepository.create({ name: displayName });
  }
}

export class UpdateDeviceGroupUseCase {
  constructor(
    private readonly deps: { deviceGroupRepository: DeviceGroupRepository },
  ) {}

  async execute(input: { id: string; name?: string }) {
    const name =
      input.name === undefined ? undefined : collapseWhitespace(input.name);
    if (name !== undefined && name.length === 0) {
      throw new ValidationError("Group name is required");
    }

    if (name !== undefined) {
      const groups = await this.deps.deviceGroupRepository.list();
      const normalizedName = normalizeName(name);
      const existing = groups.find((group) => group.id === input.id);
      if (!existing) {
        throw new NotFoundError("Device group not found");
      }
      const conflictingGroup = groups.find(
        (group) =>
          group.id !== input.id && normalizeName(group.name) === normalizedName,
      );
      if (conflictingGroup) {
        throw new DeviceGroupConflictError(
          "A device group with this name already exists",
        );
      }
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
    const uniqueGroupIds = [...new Set(input.groupIds)];

    if (uniqueGroupIds.length > 0) {
      const groups = await this.deps.deviceGroupRepository.list();
      const existingIds = new Set(groups.map((g) => g.id));
      const unknown = uniqueGroupIds.find((id) => !existingIds.has(id));
      if (unknown) throw new NotFoundError("Device group not found");
    }

    await this.deps.deviceGroupRepository.setDeviceGroups(
      input.deviceId,
      uniqueGroupIds,
    );
  }
}
