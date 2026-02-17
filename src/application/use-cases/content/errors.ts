export { NotFoundError } from "#/application/errors/not-found";

export class InvalidContentTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidContentTypeError";
  }
}

export class ContentInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentInUseError";
  }
}
