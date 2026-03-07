import { AppError } from "./app-error";

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "forbidden",
      httpStatus: 403,
    });
  }
}
