export { NotFoundError } from "#/application/errors/not-found";

import { AppError } from "#/application/errors/app-error";

export class DuplicateEmailError extends AppError {
  constructor(
    message = "A user with this email already exists",
    options?: ErrorOptions,
  ) {
    super(message, {
      ...options,
      code: "duplicate_email",
      httpStatus: 409,
    });
  }
}

export class DuplicateUsernameError extends AppError {
  constructor(
    message = "A user with this username already exists",
    options?: ErrorOptions,
  ) {
    super(message, {
      ...options,
      code: "duplicate_username",
      httpStatus: 409,
    });
  }
}
