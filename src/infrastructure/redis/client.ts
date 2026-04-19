import Redis, { type Redis as RedisClient } from 'ioredis';

export interface CreateRedisClientParams {
  url: string;
  key_prefix?: string;
}

export function createRedisClient(params: CreateRedisClientParams): RedisClient {
  return new Redis(params.url, {
    keyPrefix: params.key_prefix,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
}

export type { RedisClient };
