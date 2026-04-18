import { randomUUID } from 'crypto';
import type {
  NextFunction,
  Request,
  Response,
} from 'express';

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const request_id = req.header('x-request-id')?.trim() || randomUUID();

  res.locals.request_id = request_id;
  res.setHeader('x-request-id', request_id);
  next();
}
