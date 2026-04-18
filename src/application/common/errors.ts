export class AppError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly status_code: number;

  constructor(params: {
    code: string;
    details?: unknown;
    message: string;
    status_code: number;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.code = params.code;
    this.details = params.details;
    this.status_code = params.status_code;
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      code: 'conflict',
      details,
      message,
      status_code: 409,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      code: 'not_found',
      details,
      message,
      status_code: 404,
    });
  }
}

export class NotImplementedAppError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      code: 'not_implemented',
      details,
      message,
      status_code: 501,
    });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      code: 'unauthorized',
      details,
      message,
      status_code: 401,
    });
  }
}

export class ValidationAppError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      code: 'validation_error',
      details,
      message,
      status_code: 400,
    });
  }
}

export class RateLimitedError extends AppError {
  readonly retry_after_seconds: number;

  constructor(params: {
    details?: unknown;
    message: string;
    retry_after_seconds: number;
  }) {
    super({
      code: 'rate_limited',
      details: {
        ...(typeof params.details === 'object' && params.details !== null
          ? params.details
          : {}),
        retry_after_seconds: params.retry_after_seconds,
      },
      message: params.message,
      status_code: 429,
    });
    this.retry_after_seconds = params.retry_after_seconds;
  }
}

export class UpstreamUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      code: 'upstream_unavailable',
      details,
      message,
      status_code: 502,
    });
  }
}
