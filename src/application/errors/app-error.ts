export type AppErrorHttpStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 422
  | 429
  | 500
  | 501;

export interface AppErrorOptions extends ErrorOptions {
  code: string;
  httpStatus: AppErrorHttpStatus;
  details?: unknown;
  retryable?: boolean;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly httpStatus: AppErrorHttpStatus;
  public readonly details?: unknown;
  public readonly retryable: boolean;

  constructor(message: string, options: AppErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}
