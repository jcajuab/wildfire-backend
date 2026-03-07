import { AppError } from "./app-error";

export class NotFoundError extends AppError {
  constructor(message = "Not found", options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "not_found",
      httpStatus: 404,
    });
  }
}
