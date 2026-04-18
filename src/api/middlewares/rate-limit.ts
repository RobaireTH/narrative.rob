import rateLimit, { type Options as RateLimitOptions } from 'express-rate-limit';
import type { RequestHandler } from 'express';

import { getAuthenticatedUser } from './auth';

export interface CreatePerOwnerRateLimiterParams {
  limit: number;
  window_ms: number;
  name: string;
}

export function createPerOwnerRateLimiter(
  params: CreatePerOwnerRateLimiterParams,
): RequestHandler {
  const options: Partial<RateLimitOptions> = {
    windowMs: params.window_ms,
    limit: params.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req, res) => {
      try {
        const user = getAuthenticatedUser(res);
        return `${params.name}:${user.uid}`;
      } catch {
        return `${params.name}:${req.ip ?? 'anon'}`;
      }
    },
    handler: (_req, res) => {
      const retry_after = Number(res.getHeader('Retry-After')) || 60;
      res.status(429).json({
        error: {
          code: 'rate_limited',
          details: {
            retry_after_seconds: retry_after,
            scope: params.name,
          },
          message: `Too many ${params.name} requests. Retry after ${retry_after}s.`,
        },
        request_id: res.locals.request_id,
      });
    },
  };

  return rateLimit(options);
}
