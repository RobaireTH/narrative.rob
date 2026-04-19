import { randomUUID } from 'crypto';

import type { RedisClient } from './client';

export interface AcquiredLock {
  key: string;
  token: string;
  ttl_seconds: number;
}

export interface LockStore {
  acquire(params: {
    key: string;
    ttl_seconds: number;
  }): Promise<AcquiredLock | null>;
  release(lock: AcquiredLock): Promise<boolean>;
}

const release_script = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export class RedisLockStore implements LockStore {
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  async acquire(params: {
    key: string;
    ttl_seconds: number;
  }): Promise<AcquiredLock | null> {
    const token = randomUUID();
    const result = await this.redis.set(
      params.key,
      token,
      'EX',
      params.ttl_seconds,
      'NX',
    );

    if (result !== 'OK') {
      return null;
    }

    return {
      key: params.key,
      token,
      ttl_seconds: params.ttl_seconds,
    };
  }

  async release(lock: AcquiredLock): Promise<boolean> {
    const result = (await this.redis.eval(
      release_script,
      1,
      lock.key,
      lock.token,
    )) as number;

    return result === 1;
  }
}

export class InMemoryLockStore implements LockStore {
  private readonly locks = new Map<string, { token: string; expires_at: number }>();

  async acquire(params: { key: string; ttl_seconds: number }) {
    const existing = this.locks.get(params.key);
    const now = Date.now();

    if (existing && existing.expires_at > now) {
      return null;
    }

    const token = randomUUID();
    this.locks.set(params.key, {
      token,
      expires_at: now + params.ttl_seconds * 1000,
    });

    return {
      key: params.key,
      token,
      ttl_seconds: params.ttl_seconds,
    };
  }

  async release(lock: AcquiredLock) {
    const existing = this.locks.get(lock.key);
    if (!existing || existing.token !== lock.token) {
      return false;
    }

    this.locks.delete(lock.key);
    return true;
  }
}
