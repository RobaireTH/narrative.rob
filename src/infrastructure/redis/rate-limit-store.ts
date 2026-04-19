import type { RedisClient } from './client';

export interface RateLimitResult {
  allowed: boolean;
  remaining_seconds: number;
}

export interface RateLimitStore {
  acquireSlot(params: {
    key: string;
    window_seconds: number;
  }): Promise<RateLimitResult>;
}

export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  async acquireSlot(params: {
    key: string;
    window_seconds: number;
  }): Promise<RateLimitResult> {
    const created = await this.redis.set(
      params.key,
      '1',
      'EX',
      params.window_seconds,
      'NX',
    );

    if (created === 'OK') {
      return { allowed: true, remaining_seconds: 0 };
    }

    const ttl = await this.redis.ttl(params.key);
    return {
      allowed: false,
      remaining_seconds: ttl > 0 ? ttl : params.window_seconds,
    };
  }
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, number>();

  async acquireSlot(params: {
    key: string;
    window_seconds: number;
  }): Promise<RateLimitResult> {
    const now = Date.now();
    const existing_expires = this.windows.get(params.key) ?? 0;

    if (existing_expires > now) {
      return {
        allowed: false,
        remaining_seconds: Math.ceil((existing_expires - now) / 1000),
      };
    }

    this.windows.set(params.key, now + params.window_seconds * 1000);
    return { allowed: true, remaining_seconds: 0 };
  }
}
