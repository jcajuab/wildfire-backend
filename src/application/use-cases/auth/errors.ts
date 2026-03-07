import { AppError } from "#/application/errors/app-error";

export class InvalidCredentialsError extends AppError {
  constructor(message = "Invalid credentials", options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "invalid_credentials",
      httpStatus: 401,
    });
  }
}
