import type {
  NextFunction,
  Request,
  Response,
} from 'express';
import { ZodError } from 'zod';

import {
  AppError,
  RateLimitedError,
} from '../../application/common/errors';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: `No route exists for ${req.method} ${req.originalUrl}.`,
    },
    request_id: res.locals.request_id,
  });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const log = req.log ?? console;

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        details: error.flatten(),
        message: 'Request validation failed.',
      },
      request_id: res.locals.request_id,
    });
    return;
  }

  if (error instanceof RateLimitedError) {
    res.setHeader('Retry-After', String(error.retry_after_seconds));
    res.status(error.status_code).json({
      error: {
        code: error.code,
        details: error.details,
        message: error.message,
      },
      request_id: res.locals.request_id,
    });
    return;
  }

  if (error instanceof AppError) {
    if (error.status_code >= 500) {
      (log as { error: (payload: unknown, message?: string) => void }).error?.(
        { err: error, code: error.code, details: error.details },
        'AppError',
      );
    }
    res.status(error.status_code).json({
      error: {
        code: error.code,
        details: error.details,
        message: error.message,
      },
      request_id: res.locals.request_id,
    });
    return;
  }

  (log as { error: (payload: unknown, message?: string) => void }).error?.(
    { err: error },
    'UnhandledError',
  );

  const is_production = process.env.NODE_ENV === 'production';
  const message = is_production
    ? 'An unexpected error occurred.'
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred.';

  res.status(500).json({
    error: {
      code: 'internal_server_error',
      message,
    },
    request_id: res.locals.request_id,
  });
}
