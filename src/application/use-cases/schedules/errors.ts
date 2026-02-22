export { NotFoundError } from "#/application/errors/not-found";

export class ScheduleConflictError extends Error {
  constructor(
    message = "This schedule overlaps with an existing schedule on the selected display.",
  ) {
    super(message);
    this.name = "ScheduleConflictError";
  }
}
