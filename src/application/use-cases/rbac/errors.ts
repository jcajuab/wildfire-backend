export { NotFoundError } from "#/application/errors/not-found";

export class DuplicateEmailError extends Error {
  constructor(message = "A user with this email already exists") {
    super(message);
    this.name = "DuplicateEmailError";
  }
}

export class DuplicateUsernameError extends Error {
  constructor(message = "A user with this username already exists") {
    super(message);
    this.name = "DuplicateUsernameError";
  }
}
