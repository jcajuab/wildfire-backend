import { AppError } from "#/application/errors/app-error";

export { NotFoundError } from "#/application/errors/not-found";

export class DisplayPairingCodeCollisionError extends AppError {
  constructor() {
    super("Display pairing code collision detected", {
      code: "display_pairing_code_collision",
      httpStatus: 409,
    });
  }
}

export class DisplayAuthenticationError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "display_authentication_failed",
      httpStatus: 401,
    });
  }
}

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
