export { NotFoundError } from "#/application/errors/not-found";

import { AppError } from "#/application/errors/app-error";

export class DisplayGroupConflictError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "display_group_conflict",
      httpStatus: 409,
    });
  }
}

export class DisplayRegistrationConflictError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "display_registration_conflict",
      httpStatus: 409,
    });
  }
}
