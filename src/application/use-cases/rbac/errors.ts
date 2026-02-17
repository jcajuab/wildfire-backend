export { NotFoundError } from "#/application/errors/not-found";

export class DuplicateEmailError extends Error {
  constructor(message = "A user with this email already exists") {
    super(message);
    this.name = "DuplicateEmailError";
  }
}
