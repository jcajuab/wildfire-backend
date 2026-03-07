export { NotFoundError } from "#/application/errors/not-found";

import { AppError } from "#/application/errors/app-error";

export class PlaylistInUseError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      code: "playlist_in_use",
      httpStatus: 409,
    });
  }
}
