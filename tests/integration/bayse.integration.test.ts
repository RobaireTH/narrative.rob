import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import nock from 'nock';
import request from 'supertest';

import { buildTestApp } from './helpers';

const BAYSE_HOST = 'http://bayse.test';
const OWNER_TOKEN = 'owner-bayse-1';
const OWNER_HEADER = { authorization: `Bearer ${OWNER_TOKEN}` } as const;

function buildLoginScope() {
  return nock(BAYSE_HOST)
    .post('/v1/user/login', {
      email: 'user@example.com',
      password: 'password123',
    })
    .reply(200, {
      deviceId: 'dev-abc',
      token: 'session-token-xyz',
      userId: 'bayse-user-1',
    });
}

describe('bayse bootstrap integration', () => {
  const { app } = buildTestApp();

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterEach(() => {
    expect(nock.pendingMocks()).toEqual([]);
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  it('rejects requests without an auth token', async () => {
    const response = await request(app)
      .post('/api/bayse/accounts/connect')
      .send({ email: 'user@example.com', password: 'password123' });

    expect(response.status).toBe(401);
  });

  it('validates request bodies with a structured 400', async () => {
    const response = await request(app)
      .post('/api/bayse/accounts/connect')
      .set(OWNER_HEADER)
      .send({ email: 'not-an-email' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });

  it('connects → creates key → lists → rotates → deletes end-to-end', async () => {
    buildLoginScope();
    nock(BAYSE_HOST)
      .post('/v1/user/me/api-keys', { name: 'my-key' })
      .reply(201, {
        id: 'key-1',
        name: 'my-key',
        publicKey: 'pk_test_abc',
        secretKey: 'sk_test_xyz',
      });
    nock(BAYSE_HOST)
      .get('/v1/user/me/api-keys')
      .reply(200, [
        {
          id: 'key-1',
          name: 'my-key',
          publicKey: 'pk_test_abc',
        },
      ]);
    nock(BAYSE_HOST)
      .post('/v1/user/me/api-keys/key-1/rotate')
      .reply(200, {
        id: 'key-1',
        name: 'my-key',
        publicKey: 'pk_test_rotated',
        secretKey: 'sk_test_rotated',
      });
    nock(BAYSE_HOST).delete('/v1/user/me/api-keys/key-1').reply(204);

    const connect = await request(app)
      .post('/api/bayse/accounts/connect')
      .set(OWNER_HEADER)
      .send({ email: 'user@example.com', password: 'password123' });

    expect(connect.status).toBe(200);
    expect(connect.body.data.bayse_user_id).toBe('bayse-user-1');

    const create = await request(app)
      .post('/api/bayse/accounts/me/api-keys')
      .set(OWNER_HEADER)
      .send({ name: 'my-key' });

    expect(create.status).toBe(201);
    expect(create.body.data.api_key.public_key_preview).toContain('pk_test');
    expect(JSON.stringify(create.body)).not.toContain('sk_test_xyz');

    const list = await request(app)
      .get('/api/bayse/accounts/me/api-keys')
      .set(OWNER_HEADER);

    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data.keys)).toBe(true);
    expect(list.body.data.keys[0].key_id).toBe('key-1');

    const rotate = await request(app)
      .post('/api/bayse/accounts/me/api-keys/key-1/rotate')
      .set(OWNER_HEADER);

    expect(rotate.status).toBe(200);
    expect(JSON.stringify(rotate.body)).not.toContain('sk_test_rotated');

    const del = await request(app)
      .delete('/api/bayse/accounts/me/api-keys/key-1')
      .set(OWNER_HEADER);

    expect(del.status).toBe(200);
  });

  it('propagates Bayse 401 as UnauthorizedError', async () => {
    nock(BAYSE_HOST)
      .post('/v1/user/login')
      .reply(401, { error: 'invalid credentials' });

    const response = await request(app)
      .post('/api/bayse/accounts/connect')
      .set(OWNER_HEADER)
      .send({ email: 'user@example.com', password: 'wrong' });

    expect(response.status).toBe(401);
  });
});
