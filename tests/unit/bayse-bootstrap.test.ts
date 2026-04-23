import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';

import { BayseBootstrapService } from '../../src/application/bayse/bootstrap-service';
import { InMemoryBayseConnectionStore } from '../../src/application/bayse/credentials-service';
import { InMemoryRateLimitStore } from '../../src/infrastructure/redis/rate-limit-store';
import { RateLimitedError } from '../../src/application/common/errors';

const silent_logger = pino({ level: 'silent' });

function makeService() {
  const auth_client = {
    createApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
    listApiKeys: vi.fn(),
    login: vi.fn().mockResolvedValue({
      deviceId: 'device-from-bayse',
      token: 'token-from-bayse',
      userId: 'bayse-user-1',
    }),
    rotateApiKey: vi.fn(),
  };
  const connection_store = new InMemoryBayseConnectionStore();
  const rate_limit_store = new InMemoryRateLimitStore();

  const service = new BayseBootstrapService({
    auth_client,
    connection_store,
    logger: silent_logger,
    login_rate_limit_seconds: 60,
    rate_limit_store,
  });

  return { auth_client, connection_store, rate_limit_store, service };
}

describe('BayseBootstrapService.connectAccount', () => {
  it('persists the deviceId returned by Bayse (no client-side UUID)', async () => {
    const { auth_client, service } = makeService();

    const summary = await service.connectAccount({
      email: 'user@example.com',
      owner_id: 'owner-1',
      password: 's3cret',
    });

    expect(auth_client.login).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 's3cret',
    });
    expect(summary.bayse_user_id).toBe('bayse-user-1');
  });

  it('rate-limits repeated logins for the same email', async () => {
    const { service } = makeService();

    await service.connectAccount({
      email: 'user@example.com',
      owner_id: 'owner-1',
      password: 's3cret',
    });

    await expect(
      service.connectAccount({
        email: 'user@example.com',
        owner_id: 'owner-1',
        password: 's3cret',
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('does not leak raw secret_key in connection summary', async () => {
    const { auth_client, service } = makeService();
    auth_client.createApiKey.mockResolvedValue({
      createdAt: new Date().toISOString(),
      id: 'key-1',
      name: 'test',
      publicKey: 'pk_abcdef1234567890',
      secretKey: 'sk_SECRETVALUE',
    });

    await service.connectAccount({
      email: 'user@example.com',
      owner_id: 'owner-2',
      password: 's3cret',
    });
    const created = await service.createApiKey({
      name: 'test',
      owner_id: 'owner-2',
    });

    expect(JSON.stringify(created)).not.toContain('sk_SECRETVALUE');
    expect(created.api_key?.public_key_preview).not.toContain('sk_');
  });
});
