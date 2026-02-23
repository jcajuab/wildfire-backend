export { NotFoundError } from "#/application/errors/not-found";

export class DeviceGroupConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceGroupConflictError";
  }
}
