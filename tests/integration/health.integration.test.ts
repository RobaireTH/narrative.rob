import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { buildTestApp } from './helpers';

describe('health endpoints', () => {
  const { app } = buildTestApp();

  it('GET / returns service banner', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      service: 'narrative-api',
      node_env: 'test',
    });
    expect(response.body.request_id).toBeTypeOf('string');
  });

  it('GET /health returns ok', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it('GET /ready returns 200 in memory storage mode (no redis required)', async () => {
    const response = await request(app).get('/ready');
    expect(response.status).toBe(200);
    expect(response.body.storage_mode).toBe('memory');
  });

  it('unknown route returns a structured 404', async () => {
    const response = await request(app).get('/no-such-route');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });
});
