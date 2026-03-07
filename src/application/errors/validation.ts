import { AppError } from "./app-error";

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown, options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "validation_error",
      httpStatus: 422,
      details,
    });
  }
}
