export { NotFoundError } from "#/application/errors/not-found";

export class DisplayGroupConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisplayGroupConflictError";
  }
}
