export { NotFoundError } from "#/application/errors/not-found";

export class PlaylistInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaylistInUseError";
  }
}
